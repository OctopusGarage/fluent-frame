import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_VERSION } from "@fluent-frame/shared";
import { createQueueStore } from "../src/queueStore.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ff-queue-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("QueueStore", () => {
  it("still reports a missing job when completion or failure is persisted", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"));
      await expect(store.markDone("dQw4w9WgXcQ:en:missing", "claim")).rejects.toThrow("Queue job not found");
      await expect(store.markFailed("dQw4w9WgXcQ:en:missing", "failed", "claim")).rejects.toThrow("Queue job not found");
    });
  });

  it("persists an idempotent queued job", async () => {
    await withTempDir(async (dir) => {
      const queueFile = join(dir, "queue", "jobs.json");
      const store = createQueueStore(queueFile, { now: () => "2026-07-21T00:00:00.000Z" });

      const first = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const second = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });

      expect(first.message).toBe("Queued");
      expect(second.message).toBe("Already queued");
      expect(second.job.id).toBe(first.job.id);
      expect((await store.getQueue()).jobs).toHaveLength(1);
      await expect(readFile(queueFile, "utf8")).resolves.toContain(first.job.id);
    });
  });

  it("enriches an existing idempotent job with a later parsed title", async () => {
    await withTempDir(async (dir) => {
      let currentTime = "2026-07-21T00:00:00.000Z";
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => currentTime });

      await store.enqueue({
        videoId: "vZ5Bz6ILG5E",
        captionLanguage: "en",
        url: "https://www.youtube.com/watch?v=vZ5Bz6ILG5E",
      });
      currentTime = "2026-07-21T00:00:01.000Z";

      const second = await store.enqueue({
        videoId: "vZ5Bz6ILG5E",
        captionLanguage: "en",
        url: "https://www.youtube.com/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D",
        title: "10-Minute Match | Zidane & Henry",
      });

      expect(second.message).toBe("Already queued");
      expect(second.job.title).toBe("10-Minute Match | Zidane & Henry");
      expect(second.job.url).toBe("https://www.youtube.com/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D");
      expect(second.job.updatedAt).toBe("2026-07-21T00:00:01.000Z");
      expect((await store.getQueue()).jobs[0]).toMatchObject({
        title: "10-Minute Match | Zidane & Henry",
        url: "https://www.youtube.com/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D",
      });
    });
  });

  it("marks cached enqueue as already ready", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => "2026-07-21T00:00:00.000Z" });

      const result = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en", cacheReady: true });

      expect(result.message).toBe("Already ready");
      expect(result.job.status).toBe("done");
    });
  });

  it("marks a failed job ready when a later enqueue finds its cached result", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => "2026-07-21T00:00:00.000Z" });
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const claimed = await store.claimNext();
      await store.markFailed(job.id, "Agent failed", claimed!.claimId!);

      const result = await store.enqueue({ videoId: job.videoId, captionLanguage: "en", cacheReady: true });

      expect(result.message).toBe("Already ready");
      expect(result.job.status).toBe("done");
      expect(result.job.error).toBeUndefined();
      expect((await store.getQueue()).jobs).toEqual([result.job]);
    });
  });

  it("requeues a completed job when its cached result is no longer ready", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => "2026-07-21T00:00:00.000Z" });
      const first = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en", cacheReady: true });

      const second = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en", cacheReady: false });

      expect(first.job.status).toBe("done");
      expect(second.message).toBe("Queued");
      expect(second.job.status).toBe("queued");
      expect(second.job.finishedAt).toBeUndefined();
      expect((await store.getQueue()).jobs).toEqual([second.job]);
    });
  });

  it("keeps a completed job ready when a metadata update does not check the cache", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"));
      await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en", cacheReady: true });

      const updated = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en", title: "Video title" });

      expect(updated.message).toBe("Already ready");
      expect(updated.job).toMatchObject({ status: "done", title: "Video title" });
    });
  });

  it("claims queued jobs serially and recovers stale running jobs", async () => {
    await withTempDir(async (dir) => {
      let tick = 0;
      const store = createQueueStore(join(dir, "jobs.json"), {
        now: () => `2026-07-21T00:00:0${tick++}.000Z`,
        staleRunningMs: 0,
      });
      await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" });

      const first = await store.claimNext();

      expect(first?.videoId).toBe("dQw4w9WgXcQ");
      expect((await store.claimNext())).toBeUndefined();

      await store.recoverStaleRunningJobs();
      expect((await store.getQueue()).jobs.map((job) => job.status)).toEqual(["queued", "queued"]);
    });
  });

  it("allows only one queue store instance to claim a queued job", async () => {
    await withTempDir(async (dir) => {
      const queueFile = join(dir, "jobs.json");
      const firstStore = createQueueStore(queueFile);
      const secondStore = createQueueStore(queueFile);
      const { job } = await firstStore.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });

      const claims = await Promise.all([firstStore.claimNext(), secondStore.claimNext()]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await firstStore.getQueue()).runningJobId).toBe(job.id);
    });
  });

  it("does not recover fresh running jobs before the stale timeout", async () => {
    await withTempDir(async (dir) => {
      let currentTime = "2026-07-21T00:00:00.000Z";
      const store = createQueueStore(join(dir, "jobs.json"), {
        now: () => currentTime,
        staleRunningMs: 30 * 60 * 1000,
      });
      await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      await store.claimNext();
      currentTime = "2026-07-21T00:10:00.000Z";

      await store.recoverStaleRunningJobs();

      expect((await store.getQueue()).jobs[0]?.status).toBe("running");
    });
  });

  it("uses the running job heartbeat when recovering stale jobs", async () => {
    await withTempDir(async (dir) => {
      let currentTime = "2026-07-21T00:00:00.000Z";
      const store = createQueueStore(join(dir, "jobs.json"), {
        now: () => currentTime,
        staleRunningMs: 30 * 60 * 1000,
      });
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const claimed = await store.claimNext();

      currentTime = "2026-07-21T00:20:00.000Z";
      const touched = await store.touchRunning(job.id, claimed!.claimId!);
      expect(touched?.updatedAt).toBe("2026-07-21T00:20:00.000Z");

      currentTime = "2026-07-21T00:40:00.000Z";
      await store.recoverStaleRunningJobs();
      expect((await store.getQueue()).jobs[0]?.status).toBe("running");

      currentTime = "2026-07-21T00:51:00.000Z";
      await store.recoverStaleRunningJobs();
      expect((await store.getQueue()).jobs[0]?.status).toBe("queued");
    });
  });

  it("persists running job batch progress", async () => {
    await withTempDir(async (dir) => {
      let currentTime = "2026-07-21T00:00:00.000Z";
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => currentTime });
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const claimed = await store.claimNext();

      currentTime = "2026-07-21T00:00:30.000Z";
      const progressed = await store.markProgress(job.id, { completedBatches: 2, totalBatches: 9 }, claimed!.claimId!);

      expect(progressed).toMatchObject({
        status: "running",
        completedBatches: 2,
        totalBatches: 9,
        updatedAt: "2026-07-21T00:00:30.000Z",
      });
      expect((await store.getQueue()).jobs[0]).toMatchObject({
        completedBatches: 2,
        totalBatches: 9,
      });
    });
  });

  it("retries failed jobs and removes jobs", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => "2026-07-21T00:00:00.000Z" });
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const claimed = await store.claimNext();
      await store.markFailed(job.id, "Codex timed out", claimed!.claimId!);

      const retried = await store.retry(job.id);
      expect(retried.message).toBe("Queued");
      expect(retried.job.status).toBe("queued");
      expect(retried.job.error).toBeUndefined();

      const queue = await store.remove(job.id);
      expect(queue.jobs).toEqual([]);
    });
  });

  it("does not requeue a job that became ready before a stale retry request arrives", async () => {
    await withTempDir(async (dir) => {
      const store = createQueueStore(join(dir, "jobs.json"), { now: () => "2026-07-21T00:00:00.000Z" });
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const claimed = await store.claimNext();
      await store.markFailed(job.id, "Codex timed out", claimed!.claimId!);
      await store.enqueue({ videoId: job.videoId, captionLanguage: "en", cacheReady: true });

      const retried = await store.retry(job.id);

      expect(retried.message).toBe("Already ready");
      expect(retried.job.status).toBe("done");
      expect((await store.getQueue()).jobs[0]?.status).toBe("done");
    });
  });

  it.each(["getQueue", "enqueue"] as const)("preserves an unreadable queue and releases its lock after %s fails", async (operation) => {
    await withTempDir(async (dir) => {
      const queueFile = join(dir, "jobs.json");
      const store = createQueueStore(queueFile);
      const { job } = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const original = await readFile(queueFile, "utf8");
      await chmod(queueFile, 0o000);
      let outcome: unknown;
      try {
        outcome = await (operation === "getQueue"
          ? store.getQueue()
          : store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" })
        ).then(() => "unexpected success", (error: unknown) => error);
      } finally {
        await chmod(queueFile, 0o600).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }

      expect(outcome).toMatchObject({ code: "EACCES" });
      await expect(readFile(queueFile, "utf8")).resolves.toBe(original);
      await expect(readFile(`${queueFile}.corrupt`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(`${queueFile}.lock`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect((await store.getQueue()).jobs).toEqual([job]);
      await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" });
      expect((await store.getQueue()).jobs).toHaveLength(2);
    });
  });

  it("backs up a corrupt queue file before creating a fresh queue", async () => {
    await withTempDir(async (dir) => {
      const queueFile = join(dir, "queue", "jobs.json");
      await mkdir(join(queueFile, ".."), { recursive: true });
      await writeFile(queueFile, "{", "utf8");
      const store = createQueueStore(queueFile, { now: () => "2026-07-21T00:00:00.000Z" });

      await expect(store.getQueue()).resolves.toEqual({ paused: false, jobs: [] });
      await expect(readFile(`${queueFile}.corrupt`, "utf8")).resolves.toBe("{");
    });
  });

  it("backs up a queue file with malformed jobs before creating a fresh queue", async () => {
    await withTempDir(async (dir) => {
      const queueFile = join(dir, "queue", "jobs.json");
      await mkdir(join(queueFile, ".."), { recursive: true });
      await writeFile(
        queueFile,
        JSON.stringify({
          paused: false,
          jobs: [
            {
              id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
              videoId: "dQw4w9WgXcQ",
              captionLanguage: "en",
              workflowVersion: WORKFLOW_VERSION,
              status: "ready",
              createdAt: "2026-07-21T00:00:00.000Z",
              updatedAt: "2026-07-21T00:00:00.000Z",
            },
          ],
        }),
        "utf8",
      );
      const store = createQueueStore(queueFile);

      await expect(store.getQueue()).resolves.toEqual({ paused: false, jobs: [] });
      await expect(readFile(`${queueFile}.corrupt`, "utf8")).resolves.toContain('"status":"ready"');
    });
  });
});
