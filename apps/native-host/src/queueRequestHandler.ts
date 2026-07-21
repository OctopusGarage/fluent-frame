import type { HostRequest, HostResponse, QueueJob } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import type { ProcessVideoOutput } from "./processor.js";
import { createQueueCoordinator } from "./queueCoordinator.js";
import { createQueueRunner, type QueueRunner } from "./queueRunner.js";
import { createQueueStore, type QueueStore } from "./queueStore.js";
import { createLogger, type Logger } from "./logger.js";
import { cacheReady, resolveVideoTitle } from "./queueSupport.js";
import { startDetachedQueueWorker, startQueue, type DetachedQueueWorkerDeps } from "./queueWorkerProcess.js";
import { runVideoProcessingPipeline } from "./videoProcessingPipeline.js";

type EnqueueVideoRequest = Extract<HostRequest, { type: "enqueueVideo" }>;
type GetQueueRequest = Extract<HostRequest, { type: "getQueue" }>;
type RemoveQueueJobRequest = Extract<HostRequest, { type: "removeQueueJob" }>;
type RetryQueueJobRequest = Extract<HostRequest, { type: "retryQueueJob" }>;

export { startDetachedQueueWorker, type DetachedQueueWorkerDeps } from "./queueWorkerProcess.js";

const runners = new Map<string, QueueRunner>();

function queueErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "QUEUE_ERROR",
    message: error instanceof Error ? error.message : "Queue operation failed",
  };
}

export function isQueueReadyOutput(mode: ProcessVideoOutput["mode"]): boolean {
  return mode === "generated" || mode === "cache" || mode === "remoteCache";
}

async function processQueuedJob(config: HostConfig, logger: Logger, store: QueueStore, job: QueueJob): Promise<void> {
  await logger.log({
    level: "info",
    component: "queueProcessor",
    event: "generation.started",
    message: "Starting queued learning subtitle generation",
    jobId: job.id,
    videoId: job.videoId,
    details: { captionLanguage: job.captionLanguage, title: job.title },
  });
  const output = await runVideoProcessingPipeline(config, {
    videoId: job.videoId,
    captionLanguage: job.captionLanguage,
    async onPartialResult(_result, progress) {
      await store.markProgress(job.id, {
        completedBatches: progress.completedBatches,
        totalBatches: progress.totalBatches,
      });
      await logger.log({
        level: "info",
        component: "queueProcessor",
        event: "generation.batchCompleted",
        message: `Completed queued learning subtitle batch ${progress.completedBatches} of ${progress.totalBatches}`,
        jobId: job.id,
        videoId: job.videoId,
        details: {
          completedBatches: progress.completedBatches,
          totalBatches: progress.totalBatches,
        },
      });
    },
  });
  if (!isQueueReadyOutput(output.mode)) {
    throw new Error(output.fallbackReason ?? "Learning subtitle generation failed");
  }
  if (output.mode === "partialFallback") {
    await logger.log({
      level: "warn",
      component: "queueProcessor",
      event: "generation.partialReady",
      message: "Queued learning subtitle generation kept the last successful partial result",
      jobId: job.id,
      videoId: job.videoId,
      details: { fallbackReason: output.fallbackReason },
    });
  }
  await logger.log({
    level: "info",
    component: "queueProcessor",
    event: "generation.completed",
    message: "Queued learning subtitle generation completed",
    jobId: job.id,
    videoId: job.videoId,
    details: { mode: output.mode },
  });
}

function queueRunner(config: HostConfig): QueueRunner {
  const existing = runners.get(config.queueFile);
  if (existing) {
    return existing;
  }
  const logger = createLogger(config.logFile);
  const store = createQueueStore(config.queueFile);
  const runner = createQueueRunner({
    store,
    logger,
    processJob: (job) => processQueuedJob(config, logger, store, job),
  });
  runners.set(config.queueFile, runner);
  return runner;
}

export async function runQueueWorker(config: HostConfig): Promise<void> {
  await queueRunner(config).start();
}

export function createQueueRequestHandler(config: HostConfig) {
  const logger = createLogger(config.logFile);
  const store = createQueueStore(config.queueFile);
  function requestCoordinator(requestId: string) {
    return createQueueCoordinator({
      store,
      cacheReady: (input) => cacheReady(config, input),
      resolveTitle: (videoId, title) => resolveVideoTitle(config, videoId, title),
      startQueue: () => startQueue(config),
      async log({ event, message, job, queue, jobId }) {
        await logger.log({
          level: "info",
          component: "queue",
          event,
          message,
          requestId,
          ...(job ? { jobId: job.id, videoId: job.videoId } : {}),
          ...(jobId ? { jobId } : {}),
          details: {
            ...(job ? { status: job.status, title: job.title, url: job.url } : {}),
            ...(queue
              ? {
                  jobs: queue.jobs.length,
                  runningJobId: queue.runningJobId,
                  queued: queue.jobs.filter((candidate) => candidate.status === "queued").length,
                }
              : {}),
          },
        });
      },
    });
  }
  return {
    async enqueueVideo(request: EnqueueVideoRequest): Promise<HostResponse> {
      try {
        const { job, message } = await requestCoordinator(request.id).enqueueVideo({
          videoId: request.videoId,
          captionLanguage: request.captionLanguage,
          ...(request.url ? { url: request.url } : {}),
          ...(request.title ? { title: request.title } : {}),
        });
        return { id: request.id, ok: true, type: "queueJob", job, message };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async getQueue(request: GetQueueRequest): Promise<HostResponse> {
      try {
        const queue = await requestCoordinator(request.id).getQueue();
        return { id: request.id, ok: true, type: "queue", queue };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async removeQueueJob(request: RemoveQueueJobRequest): Promise<HostResponse> {
      try {
        const queue = await requestCoordinator(request.id).removeJob(request.jobId);
        return { id: request.id, ok: true, type: "queue", queue };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async retryQueueJob(request: RetryQueueJobRequest): Promise<HostResponse> {
      try {
        const { job, message } = await requestCoordinator(request.id).retryJob(request.jobId);
        return { id: request.id, ok: true, type: "queueJob", job, message };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
  };
}
