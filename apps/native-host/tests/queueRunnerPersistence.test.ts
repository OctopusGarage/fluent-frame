import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { createQueueCoordinator } from "../src/queueCoordinator.js";
import { createQueueRunner } from "../src/queueRunner.js";
import { createQueueStore } from "../src/queueStore.js";

async function withQueue(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ff-queue-runner-"));
  try {
    await fn(dir);
  } finally {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("QueueRunner persistence", () => {
  it.each([false, true])("does not let a recovered claim be changed by its prior worker (prior worker fails: %s)", async (fails) => {
    await withQueue(async (dir) => {
      let currentMs = Date.parse("2026-07-21T00:00:00.000Z");
      const queueFile = join(dir, "jobs.json");
      const firstLogFile = join(dir, "first-runner.log");
      const options = { now: () => new Date(currentMs).toISOString(), staleRunningMs: 100 };
      const firstStore = createQueueStore(queueFile, options);
      const secondStore = createQueueStore(queueFile, options);
      const { job } = await firstStore.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      let firstStarted!: () => void;
      const firstClaimed = new Promise<void>((resolve) => { firstStarted = resolve; });
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
      let secondStarted!: () => void;
      const secondClaimed = new Promise<void>((resolve) => { secondStarted = resolve; });
      let releaseSecond!: () => void;
      const secondCanFinish = new Promise<void>((resolve) => { releaseSecond = resolve; });
      let firstClaimId: string | undefined;
      let secondClaimId: string | undefined;
      const firstRun = createQueueRunner({
        store: firstStore,
        logger: createLogger(firstLogFile),
        heartbeatIntervalMs: 0,
        processJob: async (claimed) => {
          firstClaimId = claimed.claimId;
          firstStarted();
          await firstCanFinish;
          expect(await firstStore.touchRunning(claimed.id, claimed.claimId!)).toBeUndefined();
          expect(await firstStore.markProgress(claimed.id, { completedBatches: 9, totalBatches: 9 }, claimed.claimId!)).toBeUndefined();
          if (fails) throw new Error("Prior worker failed late");
        },
      }).start();
      await firstClaimed;
      currentMs += 101;
      const secondRun = createQueueRunner({
        store: secondStore,
        heartbeatIntervalMs: 0,
        processJob: async (claimed) => {
          secondClaimId = claimed.claimId;
          secondStarted();
          await secondCanFinish;
        },
      }).start();
      await secondClaimed;
      try {
        releaseFirst();
        await firstRun;
        const current = (await secondStore.getQueue()).jobs[0];
        expect(current).toMatchObject({
          id: job.id,
          claimId: secondClaimId,
          status: "running",
          completedBatches: 0,
          updatedAt: new Date(currentMs).toISOString(),
        });
        expect(firstClaimId).toBeTruthy();
        expect(secondClaimId).toBeTruthy();
        expect(secondClaimId).not.toBe(firstClaimId);
        const events = (await readFile(firstLogFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line).event);
        expect(events).toContain("job.claimLost");
        expect(events).not.toContain("job.completed");
        expect(events).not.toContain("job.failed");
      } finally {
        releaseSecond();
        await secondRun;
      }
      expect((await secondStore.getQueue()).jobs[0]?.status).toBe("done");
    });
  });

  it("resumes a queue at the stale threshold after an earlier worker dies", async () => {
    await withQueue(async (dir) => {
      let currentMs = Date.parse("2026-07-21T00:00:00.000Z");
      const store = createQueueStore(join(dir, "jobs.json"), {
        now: () => new Date(currentMs).toISOString(),
        staleRunningMs: 100,
      });
      const first = (await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" })).job;
      const second = (await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" })).job;
      await store.claimNext(); // The original worker died while this job was fresh.
      const processed: string[] = [];
      const waits: number[] = [];
      let active = 0;
      let peakActive = 0;
      const runner = createQueueRunner({
        store,
        heartbeatIntervalMs: 0,
        waitForBlockedJob: true,
        wait: async (ms) => {
          waits.push(ms);
          expect(processed).toEqual([]);
          currentMs += ms;
        },
        processJob: async (job) => {
          active += 1;
          peakActive = Math.max(peakActive, active);
          processed.push(job.id);
          active -= 1;
        },
      });

      await runner.start();

      expect(waits).toEqual([100]);
      expect(processed).toEqual([first.id, second.id]);
      expect(peakActive).toBe(1);
      expect((await store.getQueue()).jobs.map((job) => job.status)).toEqual(["done", "done"]);
    });
  });

  it("leaves a live worker's heartbeating job alone while waiting for the next job", async () => {
    await withQueue(async (dir) => {
      let currentMs = Date.parse("2026-07-21T00:00:00.000Z");
      const store = createQueueStore(join(dir, "jobs.json"), {
        now: () => new Date(currentMs).toISOString(),
        staleRunningMs: 100,
      });
      const first = (await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" })).job;
      const second = (await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" })).job;
      const claimed = await store.claimNext();
      const waits: number[] = [];
      const processed: string[] = [];
      const runner = createQueueRunner({
        store,
        heartbeatIntervalMs: 0,
        waitForBlockedJob: true,
        wait: async (ms) => {
          waits.push(ms);
          if (waits.length === 1) {
            currentMs += 90;
            await store.touchRunning(first.id, claimed!.claimId!);
            currentMs += 10;
          } else {
            await store.markDone(first.id, claimed!.claimId!);
            currentMs += ms;
          }
        },
        processJob: async (job) => { processed.push(job.id); },
      });

      await runner.start();

      expect(waits).toEqual([100, 90]);
      expect(processed).toEqual([second.id]);
      expect((await store.getQueue()).jobs.map((job) => job.status)).toEqual(["done", "done"]);
    });
  });

  it("keeps an in-flight job claimed when removal and another worker are requested", async () => {
    await withQueue(async (dir) => {
      const queueFile = join(dir, "jobs.json");
      const store = createQueueStore(queueFile);
      const first = (await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" })).job;
      const second = (await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" })).job;
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => { signalStarted = resolve; });
      let releaseFirst!: () => void;
      const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
      let active = 0;
      let peakActive = 0;
      const processed: string[] = [];
      const processJob = async (job: { id: string }) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        processed.push(job.id);
        if (job.id === first.id && processed.filter((id) => id === first.id).length === 1) {
          signalStarted();
          await firstCanFinish;
        }
        active -= 1;
      };
      const firstRun = createQueueRunner({ store, processJob }).start();
      await started;
      try {
        const removal = await createQueueStore(queueFile).remove(first.id).then(
          () => "removed",
          (error: unknown) => error,
        );
        const duplicate = await store.enqueue({ videoId: first.videoId, captionLanguage: "en" });
        const retry = await store.retry(first.id);
        const workerRuns: Promise<void>[] = [];
        const coordinator = createQueueCoordinator({
          store,
          cacheReady: async () => false,
          resolveTitle: async () => undefined,
          startQueue: () => { workerRuns.push(createQueueRunner({ store: createQueueStore(queueFile), processJob }).start()); },
          log: async () => {},
        });
        await coordinator.getQueue();
        await Promise.all(workerRuns);
        await createQueueRunner({ store: createQueueStore(queueFile), processJob }).start();

        expect(peakActive).toBe(1);
        expect(removal).toMatchObject({ message: "Cannot remove a running queue job" });
        expect(duplicate.message).toBe("Already generating");
        expect(retry.message).toBe("Already generating");
        expect((await store.getQueue()).runningJobId).toBe(first.id);
        expect(processed).toEqual([first.id]);
      } finally {
        releaseFirst();
        await firstRun;
      }
      expect(processed).toEqual([first.id, second.id]);
      expect((await store.getQueue()).jobs.map((job) => job.status)).toEqual(["done", "done"]);
    });
  });

  it.each([false, true])("rejects removal during processing and continues (processing fails: %s)", async (fails) => {
    await withQueue(async (dir) => {
      const queueFile = join(dir, "jobs.json");
      const store = createQueueStore(queueFile);
      const first = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const second = await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" });
      const processed: string[] = [];
      const runner = createQueueRunner({
        store,
        logger: createLogger(join(dir, "runner.log")),
        processJob: async (job) => {
          processed.push(job.id);
          if (job.id === first.job.id) {
            await expect(createQueueStore(queueFile).remove(job.id)).rejects.toThrow("Cannot remove a running queue job");
            if (fails) throw new Error("Generation failed after removal was rejected");
          }
        },
      });

      await runner.start();

      expect(processed).toEqual([first.job.id, second.job.id]);
      const saved = await createQueueStore(queueFile).getQueue();
      expect(saved.jobs).toHaveLength(2);
      expect(saved.jobs[0]).toMatchObject({ id: first.job.id, status: fails ? "failed" : "done" });
      expect(saved.jobs[1]).toMatchObject({ id: second.job.id, status: "done" });
      expect(saved.runningJobId).toBeUndefined();
      expect(runner.isRunning()).toBe(false);
      const events = (await readFile(join(dir, "runner.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(events.filter((event) => event.event === "job.completed").map((event) => event.jobId)).toEqual(
        fails ? [second.job.id] : [first.job.id, second.job.id],
      );
    });
  });

  it.each([false, true])("rejects a persistence failure and permits recovery (processing fails: %s)", async (fails) => {
    await withQueue(async (dir) => {
      const queueDir = join(dir, "queue");
      const savedDir = join(dir, "saved-queue");
      const queueFile = join(queueDir, "jobs.json");
      const logFile = join(dir, "runner.log");
      const store = createQueueStore(queueFile);
      const first = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
      const second = await store.enqueue({ videoId: "o3RPPjzciqo", captionLanguage: "en" });
      const processed: string[] = [];
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const runner = createQueueRunner({
        store,
        logger: createLogger(logFile),
        processJob: async (job) => {
          processed.push(job.id);
          expect(vi.getTimerCount()).toBe(1);
          // Preserve the durable queue while making its parent path unwritable.
          await rename(queueDir, savedDir);
          await writeFile(queueDir, "blocked queue directory");
          if (fails) throw new Error("Generation failed before persistence");
        },
      });

      await expect(runner.start()).rejects.toMatchObject({ code: "EEXIST" });

      expect(processed).toEqual([first.job.id]);
      expect(runner.isRunning()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      await rm(queueDir);
      await rename(savedDir, queueDir);
      const saved = await createQueueStore(queueFile).getQueue();
      expect(saved.jobs.map((job) => job.status)).toEqual(["running", "queued"]);
      expect(saved.runningJobId).toBe(first.job.id);
      expect(saved.jobs[0]?.error).toBeUndefined();
      const events = (await readFile(logFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line).event);
      expect(events).not.toContain("job.completed");
      expect(events).not.toContain("job.failed");
      expect(events.at(-1)).toBe("runner.stopped");

      // A later worker can recover the persisted running job after storage returns.
      const recovered: string[] = [];
      const recovery = createQueueRunner({
        store: createQueueStore(queueFile, { staleRunningMs: 0 }),
        processJob: async (job) => { recovered.push(job.id); },
      });
      await recovery.start();
      expect(recovered).toEqual([first.job.id, second.job.id]);
      expect((await createQueueStore(queueFile).getQueue()).jobs.map((job) => job.status)).toEqual(["done", "done"]);
      expect(recovery.isRunning()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
