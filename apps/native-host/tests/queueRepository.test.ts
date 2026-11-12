import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_VERSION, type QueueJob } from "@fluent-frame/shared";
import { createQueueRepository } from "../src/queueRepository.js";

const job: QueueJob = {
  id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
  videoId: "dQw4w9WgXcQ", captionLanguage: "en", workflowVersion: WORKFLOW_VERSION,
  status: "running", claimId: "current", createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
};

async function withRepository(fn: (file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ff-queue-repository-"));
  try {
    const file = join(dir, "jobs.json");
    await writeFile(file, JSON.stringify({ paused: false, jobs: [job] }, null, 2));
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("QueueRepository", () => {
  it("reads the authoritative claim after waiting for another transaction's lock", async () => {
    await withRepository(async (file) => {
      const repository = createQueueRepository(file);
      const original = await readFile(file, "utf8");
      await writeFile(`${file}.lock`, "another owner");
      let invoked = false;
      const waiting = repository.updateRunning(job.id, "current", "throw", (current) => {
        invoked = true;
        return { ...current, status: "done" };
      });
      // The in-flight call may only decide after the lock holder's replacement is durable.
      const replacement = { ...job, claimId: "replacement" };
      const replaced = JSON.stringify({ paused: false, jobs: [replacement] }, null, 4);
      await writeFile(file, replaced);
      await rm(`${file}.lock`);
      expect(await waiting).toBeUndefined();
      expect(invoked).toBe(false);
      expect(replaced).not.toBe(original);
      await expect(readFile(file, "utf8")).resolves.toBe(replaced);
      expect((await repository.read()).jobs).toEqual([replacement]);
      // Losing authority does not consume or retire the new owner's obligations.
      const done = await createQueueRepository(file).updateRunning(job.id, "replacement", "throw", (current) => ({ ...current, status: "done" }));
      expect(done?.status).toBe("done");
    });
  });

  it("holds the lock while deciding and publishes only after durable persistence", async () => {
    await withRepository(async (file) => {
      const repository = createQueueRepository(file);
      const original = await readFile(file, "utf8");
      let lockObservation = false;
      let diskObservation: string | undefined;
      const updated = await repository.updateRunning(job.id, "current", "throw", (current) => {
        // Keep observations outside the callback: production error handling must not swallow assertions.
        lockObservation = existsSync(`${file}.lock`);
        diskObservation = readFileSync(file, "utf8");
        return { ...current, completedBatches: 1, totalBatches: 3 };
      });
      expect(lockObservation).toBe(true);
      expect(diskObservation).toBe(original);
      expect((await createQueueRepository(file).read()).jobs).toEqual([updated]);
      await expect(readFile(`${file}.lock`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("does not persist a rejected decision and releases its lock for a later owner", async () => {
    await withRepository(async (file) => {
      const repository = createQueueRepository(file);
      const original = await readFile(file, "utf8");
      await expect(repository.updateRunning(job.id, "current", "throw", () => {
        throw new Error("Transition rejected");
      })).rejects.toThrow("Transition rejected");
      await expect(readFile(file, "utf8")).resolves.toBe(original);
      await expect(readFile(`${file}.lock`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(await repository.updateRunning(job.id, "current", "throw", (current) => ({ ...current, status: "failed" }))).toMatchObject({ status: "failed" });
    });
  });

  it("normalizes transaction snapshots and distinguishes a read-only decision from an empty write", async () => {
    await withRepository(async (file) => {
      const repository = createQueueRepository(file);
      const original = await readFile(file, "utf8");
      expect(await repository.transact((state) => ({ value: state.runningJobId }))).toBe(job.id);
      await expect(readFile(file, "utf8")).resolves.toBe(original);
      const value = await repository.transact(() => ({ value: "removed", jobs: [] }));
      expect(value).toBe("removed");
      expect(await repository.read()).toEqual({ paused: false, jobs: [] });
      await expect(repository.updateRunning(job.id, "current", "ignore", () => job)).resolves.toBeUndefined();
      await expect(repository.updateRunning(job.id, "current", "throw", () => job)).rejects.toThrow("Queue job not found");
    });
  });
});
