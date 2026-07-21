import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_VERSION, type QueueJob } from "@fluent-frame/shared";
import { createQueueRunner } from "../src/queueRunner.js";
import type { QueueStore } from "../src/queueStore.js";

function job(videoId: string): QueueJob {
  return {
    id: `${videoId}:en:${WORKFLOW_VERSION}`,
    videoId,
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    status: "running",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function createMemoryStore(jobs: QueueJob[]): QueueStore {
  let running = false;
  return {
    async enqueue() {
      throw new Error("not used");
    },
    async getQueue() {
      return { paused: false, jobs };
    },
    async remove() {
      return { paused: false, jobs };
    },
    async retry() {
      throw new Error("not used");
    },
    async recoverStaleRunningJobs() {
      running = false;
    },
    async claimNext() {
      if (running) {
        return undefined;
      }
      const next = jobs.find((candidate) => candidate.status === "queued");
      if (!next) {
        return undefined;
      }
      running = true;
      next.status = "running";
      return next;
    },
    async touchRunning(jobId) {
      const target = jobs.find((candidate) => candidate.id === jobId);
      if (!target || target.status !== "running") {
        return undefined;
      }
      target.updatedAt = "2026-07-21T00:00:01.000Z";
      return target;
    },
    async markProgress(jobId, progress) {
      const target = jobs.find((candidate) => candidate.id === jobId);
      if (!target || target.status !== "running") {
        return undefined;
      }
      target.completedBatches = progress.completedBatches;
      target.totalBatches = progress.totalBatches;
      return target;
    },
    async markDone(jobId) {
      const target = jobs.find((candidate) => candidate.id === jobId);
      if (!target) {
        throw new Error("missing job");
      }
      target.status = "done";
      running = false;
      return target;
    },
    async markFailed(jobId, error) {
      const target = jobs.find((candidate) => candidate.id === jobId);
      if (!target) {
        throw new Error("missing job");
      }
      target.status = "failed";
      target.error = error;
      running = false;
      return target;
    },
  };
}

describe("QueueRunner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes queued jobs serially and ignores duplicate starts", async () => {
    const first = { ...job("dQw4w9WgXcQ"), status: "queued" as const };
    const second = { ...job("o3RPPjzciqo"), status: "queued" as const };
    const processed: string[] = [];
    const runner = createQueueRunner({
      store: createMemoryStore([first, second]),
      processJob: async (nextJob) => {
        processed.push(nextJob.id);
      },
    });

    await Promise.all([runner.start(), runner.start()]);

    expect(processed).toEqual([first.id, second.id]);
    expect(runner.isRunning()).toBe(false);
  });

  it("marks failed jobs when processing throws", async () => {
    const queued = { ...job("dQw4w9WgXcQ"), status: "queued" as const };
    const runner = createQueueRunner({
      store: createMemoryStore([queued]),
      processJob: async () => {
        throw new Error("Codex timed out");
      },
    });

    await runner.start();

    expect(queued.status).toBe("failed");
    expect(queued.error).toBe("Codex timed out");
  });

  it("refreshes the running job heartbeat while processing", async () => {
    vi.useFakeTimers();
    const queued = { ...job("dQw4w9WgXcQ"), status: "queued" as const };
    const store = createMemoryStore([queued]);
    const touchRunning = vi.spyOn(store, "touchRunning");
    let finishProcessing: () => void = () => {};
    const runner = createQueueRunner({
      store,
      heartbeatIntervalMs: 50,
      processJob: () => new Promise<void>((resolve) => {
        finishProcessing = resolve;
      }),
    });

    const started = runner.start();
    await vi.advanceTimersByTimeAsync(150);
    finishProcessing();
    await started;

    expect(touchRunning).toHaveBeenCalled();
    expect(queued.status).toBe("done");
  });
});
