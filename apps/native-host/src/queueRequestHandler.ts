import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import { createQueueCoordinator } from "./queueCoordinator.js";
import { createQueueRunner, type QueueRunner } from "./queueRunner.js";
import { createQueueStore } from "./queueStore.js";
import { createLogger } from "./logger.js";
import { createQueuedJobProcessor } from "./queueProcessor.js";
import { createQueueEventLogger } from "./queueEventLogger.js";
import { cacheReady, resolveVideoTitle } from "./queueSupport.js";
import { startDetachedQueueWorker, startQueue, type DetachedQueueWorkerDeps } from "./queueWorkerProcess.js";

type EnqueueVideoRequest = Extract<HostRequest, { type: "enqueueVideo" }>;
type GetQueueRequest = Extract<HostRequest, { type: "getQueue" }>;
type RemoveQueueJobRequest = Extract<HostRequest, { type: "removeQueueJob" }>;
type RetryQueueJobRequest = Extract<HostRequest, { type: "retryQueueJob" }>;

export { startDetachedQueueWorker, type DetachedQueueWorkerDeps } from "./queueWorkerProcess.js";
export { isQueueReadyOutput } from "./queueProcessor.js";

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
    processJob: createQueuedJobProcessor(config, logger, store),
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
      log: createQueueEventLogger(logger, requestId),
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
