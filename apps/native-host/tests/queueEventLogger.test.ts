import { describe, expect, it, vi } from "vitest";
import { WORKFLOW_VERSION, type QueueJob } from "@fluent-frame/shared";
import { createQueueEventLogger } from "../src/queueEventLogger.js";
import type { Logger } from "../src/logger.js";

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

describe("createQueueEventLogger", () => {
  it("logs queue coordinator events with request, job, and queue summaries", async () => {
    const logger: Logger = { log: vi.fn(async () => {}) };
    const log = createQueueEventLogger(logger, "queue1");
    const running = queueJob({ status: "running" });
    const queued = queueJob({ videoId: "o3RPPjzciqo", status: "queued", title: "Queue title" });

    await log({
      event: "queue.read",
      message: "Read learning subtitle queue",
      jobId: queued.id,
      job: queued,
      queue: { paused: false, runningJobId: running.id, jobs: [running, queued] },
    });

    expect(logger.log).toHaveBeenCalledWith({
      level: "info",
      component: "queue",
      event: "queue.read",
      message: "Read learning subtitle queue",
      requestId: "queue1",
      jobId: queued.id,
      videoId: queued.videoId,
      details: {
        status: "queued",
        title: "Queue title",
        url: undefined,
        jobs: 2,
        runningJobId: running.id,
        queued: 1,
      },
    });
  });
});
