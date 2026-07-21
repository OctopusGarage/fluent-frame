import { describe, expect, it, vi } from "vitest";
import { WORKFLOW_VERSION, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { createQueueCoordinator, type QueueCoordinatorStore } from "../src/queueCoordinator.js";

function queueJob(input: { videoId?: string; status?: QueueJob["status"]; title?: string }): QueueJob {
  const videoId = input.videoId ?? "dQw4w9WgXcQ";
  return {
    id: `${videoId}:en:${WORKFLOW_VERSION}`,
    videoId,
    ...(input.title ? { title: input.title } : {}),
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    status: input.status ?? "queued",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function createStore(state: QueueState): QueueCoordinatorStore {
  return {
    enqueue: vi.fn(async (input) => {
      const job = queueJob({
        videoId: input.videoId,
        status: input.cacheReady ? "done" : "queued",
        title: input.title,
      });
      state.jobs = [job];
      return { job, message: input.cacheReady ? "Already ready" : "Queued" };
    }),
    getQueue: vi.fn(async () => state),
    remove: vi.fn(async (jobId) => {
      state.jobs = state.jobs.filter((job) => job.id !== jobId);
      return state;
    }),
    retry: vi.fn(async (jobId) => {
      const job = state.jobs.find((candidate) => candidate.id === jobId) ?? queueJob({});
      job.status = "queued";
      return { job, message: "Queued" };
    }),
    recoverStaleRunningJobs: vi.fn(async () => {}),
  };
}

describe("QueueCoordinator", () => {
  it("enriches, checks cache readiness, enqueues, and starts queued work", async () => {
    const startQueue = vi.fn();
    const store = createStore({ paused: false, jobs: [] });
    const coordinator = createQueueCoordinator({
      store,
      startQueue,
      cacheReady: vi.fn(async () => false),
      resolveTitle: vi.fn(async () => "Resolved title"),
      log: vi.fn(),
    });

    const result = await coordinator.enqueueVideo({
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });

    expect(result.job.title).toBe("Resolved title");
    expect(result.message).toBe("Queued");
    expect(startQueue).toHaveBeenCalledOnce();
    expect(store.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      videoId: "dQw4w9WgXcQ",
      title: "Resolved title",
      cacheReady: false,
    }));
  });

  it("recovers stale jobs, enriches visible queue titles, and starts queued work on queue read", async () => {
    const startQueue = vi.fn();
    const missingTitle = queueJob({ videoId: "o3RPPjzciqo" });
    const store = createStore({ paused: false, jobs: [missingTitle] });
    const coordinator = createQueueCoordinator({
      store,
      startQueue,
      cacheReady: vi.fn(),
      resolveTitle: vi.fn(async () => "Queue title"),
      log: vi.fn(),
    });

    const queue = await coordinator.getQueue();

    expect(queue.jobs[0]?.title).toBe("Queue title");
    expect(store.recoverStaleRunningJobs).toHaveBeenCalledOnce();
    expect(startQueue).toHaveBeenCalledOnce();
  });
});
