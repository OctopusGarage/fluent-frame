import type { QueueJob, QueueState } from "@fluent-frame/shared";
import type { Logger } from "./logger.js";
import type { QueueCoordinatorDeps } from "./queueCoordinator.js";

function queueDetails(queue: QueueState): Record<string, unknown> {
  return {
    jobs: queue.jobs.length,
    runningJobId: queue.runningJobId,
    queued: queue.jobs.filter((candidate) => candidate.status === "queued").length,
  };
}

function jobDetails(job: QueueJob): Record<string, unknown> {
  return {
    status: job.status,
    title: job.title,
    url: job.url,
  };
}

export function createQueueEventLogger(logger: Logger, requestId: string): QueueCoordinatorDeps["log"] {
  return async ({ event, message, job, queue, jobId }) => {
    await logger.log({
      level: "info",
      component: "queue",
      event,
      message,
      requestId,
      ...(job ? { jobId: job.id, videoId: job.videoId } : {}),
      ...(jobId ? { jobId } : {}),
      details: {
        ...(job ? jobDetails(job) : {}),
        ...(queue ? queueDetails(queue) : {}),
      },
    });
  };
}
