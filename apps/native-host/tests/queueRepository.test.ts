import { mkdtemp, open, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createQueueRepository } from "../src/queueRepository.js";
import { createQueueStore } from "../src/queueStore.js";

describe("queue repository ownership contract", () => {
  it("checks ownership after obtaining the lock and never calls a stale transition", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-repository-"));
    try {
      const file = join(dir, "jobs.json");
      const store = createQueueStore(file, { staleRunningMs: 0 });
      await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const old = (await store.claimNext())!;
      const current = { ...old, claimId: "replacement-claim" };
      const before = JSON.stringify({ paused: false, runningJobId: current.id, jobs: [current] });
      const lock = await open(`${file}.lock`, "wx");
      let called = false;
      const pending = createQueueRepository(file).updateRunning(old.id, old.claimId!, (job) => {
        called = true;
        return { ...job, status: "done" };
      });
      let settled = false;
      void pending.then(() => { settled = true; });
      try {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(settled).toBe(false);
        expect(called).toBe(false);
        // The current lock holder replaces the claim while the old worker waits.
        await writeFile(file, before);
      } finally {
        await lock.close();
        await unlink(`${file}.lock`);
      }
      expect(await pending).toBeUndefined();
      expect(called).toBe(false);
      expect(await readFile(file, "utf8")).toBe(before);
      expect((await store.getQueue()).jobs[0]?.claimId).toBe(current.claimId);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["heartbeat", "progress", "done", "failed"] as const)("preserves legacy %s fencing, timestamps, and missing-job behavior", async (operation) => {
    const dir = await mkdtemp(join(tmpdir(), "ff-ownership-"));
    try {
      const file = join(dir, "jobs.json");
      let time = "2026-10-24T00:00:00.000Z";
      const store = createQueueStore(file, { now: () => time, staleRunningMs: 0 });
      await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const old = (await store.claimNext())!;
      await store.recoverStaleRunningJobs();
      const current = (await store.claimNext())!;
      const update = (id: string, claim: string) => {
        if (operation === "heartbeat") return store.touchRunning(id, claim);
        if (operation === "progress") return store.markProgress(id, { completedBatches: 2, totalBatches: 3 }, claim);
        if (operation === "done") return store.markDone(id, claim);
        return store.markFailed(id, "generation failed", claim);
      };
      const before = await readFile(file, "utf8");
      expect(await update(old.id, old.claimId!)).toBeUndefined();
      expect(await readFile(file, "utf8")).toBe(before);
      time = "2026-10-24T00:01:00.000Z";
      const updated = await update(current.id, current.claimId!);
      expect(updated?.updatedAt).toBe(time);
      expect((await createQueueStore(file).getQueue()).jobs).toEqual([updated]);
      if (operation === "done" || operation === "failed") {
        expect(updated?.claimId).toBeUndefined();
        expect(updated?.finishedAt).toBe(time);
        expect(await update(current.id, current.claimId!)).toBeUndefined();
        await expect(update("missing", current.claimId!)).rejects.toThrow("Queue job not found");
      } else {
        expect(updated?.claimId).toBe(current.claimId);
        expect(await update("missing", current.claimId!)).toBeUndefined();
      }
      if (operation === "progress") expect(updated).toMatchObject({ completedBatches: 2, totalBatches: 3 });
      if (operation === "failed") expect(updated?.error).toBe("generation failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
