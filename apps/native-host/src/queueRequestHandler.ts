import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostRequest, HostResponse, QueueJob, QueueState } from "@fluent-frame/shared";
import { readCachedResult } from "./cache.js";
import { createConfiguredRunner } from "./agentRunner.js";
import { downloadCaptions } from "./captionDownloader.js";
import type { HostConfig } from "./config.js";
import { processVideo, type ProcessVideoOutput } from "./processor.js";
import { createQueueRunner, type QueueRunner } from "./queueRunner.js";
import { createQueueStore, type QueueStore } from "./queueStore.js";
import { fetchVideoTitle } from "./videoMetadata.js";
import { createLogger, type Logger } from "./logger.js";

type EnqueueVideoRequest = Extract<HostRequest, { type: "enqueueVideo" }>;
type GetQueueRequest = Extract<HostRequest, { type: "getQueue" }>;
type RemoveQueueJobRequest = Extract<HostRequest, { type: "removeQueueJob" }>;
type RetryQueueJobRequest = Extract<HostRequest, { type: "retryQueueJob" }>;

const runners = new Map<string, QueueRunner>();

type DetachedQueueWorkerProcess = {
  unref(): void;
};

export type DetachedQueueWorkerDeps = {
  entrypointPath?: string;
  env?: NodeJS.ProcessEnv;
  spawnDetached?: (
    command: string,
    args: string[],
    options: {
      detached: true;
      stdio: "ignore";
      env: NodeJS.ProcessEnv;
    },
  ) => DetachedQueueWorkerProcess;
};

function defaultEntrypointPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "index.js");
}

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
  return mode === "generated" || mode === "cache" || mode === "partialFallback";
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
  const runAgent = await createConfiguredRunner(config.agent, {
    codexPath: config.codexPath,
    claudePath: config.claudePath,
  });
  const output = await processVideo(job.videoId, job.captionLanguage, {
    cacheDir: config.cacheDir,
    downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
    runAgent,
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

export async function startDetachedQueueWorker(config: HostConfig, deps: DetachedQueueWorkerDeps = {}): Promise<void> {
  const entrypointPath = deps.entrypointPath ?? defaultEntrypointPath();
  const child = (deps.spawnDetached ?? spawn)(process.execPath, [entrypointPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...(deps.env ?? process.env),
      FF_QUEUE_WORKER: "1",
      FF_AGENT: config.agent,
      FF_CACHE_DIR: config.cacheDir,
      FF_NOTES_FILE: config.notesFile,
      FF_QUEUE_FILE: config.queueFile,
      FF_LOG_FILE: config.logFile,
      FF_YTDLP_PATH: config.ytDlpPath,
      FF_CODEX_PATH: config.codexPath,
      FF_CLAUDE_PATH: config.claudePath,
    },
  });
  child.unref();
}

function startQueue(config: HostConfig): void {
  void startDetachedQueueWorker(config).catch(async (error: unknown) => {
    await createLogger(config.logFile).log({
      level: "error",
      component: "queueWorker",
      event: "worker.startFailed",
      message: "Failed to start detached queue worker",
      details: { error },
    });
  });
}

async function cacheReady(config: HostConfig, request: EnqueueVideoRequest): Promise<boolean> {
  try {
    return Boolean(await readCachedResult(config.cacheDir, request.videoId, request.captionLanguage));
  } catch {
    return false;
  }
}

async function resolveVideoTitle(config: HostConfig, videoId: string, title: string | undefined): Promise<string | undefined> {
  if (title?.trim()) {
    return title.trim();
  }
  const logger = createLogger(config.logFile);
  try {
    const resolved = await fetchVideoTitle(videoId, config.ytDlpPath);
    await logger.log({
      level: resolved ? "info" : "warn",
      component: "videoMetadata",
      event: resolved ? "title.resolved" : "title.empty",
      message: resolved ? "Resolved YouTube video title" : "YouTube title metadata was empty",
      videoId,
      details: { title: resolved },
    });
    return resolved;
  } catch (error) {
    await logger.log({
      level: "warn",
      component: "videoMetadata",
      event: "title.failed",
      message: "Failed to resolve YouTube video title",
      videoId,
      details: { error },
    });
    return undefined;
  }
}

async function enrichMissingQueueTitles(config: HostConfig, store: QueueStore): Promise<QueueState> {
  let queue = await store.getQueue();
  for (const job of queue.jobs.filter((candidate) => !candidate.title).slice(0, 8)) {
    const title = await resolveVideoTitle(config, job.videoId, undefined);
    if (title) {
      await store.enqueue({
        videoId: job.videoId,
        captionLanguage: job.captionLanguage,
        ...(job.url ? { url: job.url } : {}),
        title,
      });
    }
  }
  queue = await store.getQueue();
  return queue;
}

export function createQueueRequestHandler(config: HostConfig) {
  const logger = createLogger(config.logFile);
  const store = createQueueStore(config.queueFile);
  return {
    async enqueueVideo(request: EnqueueVideoRequest): Promise<HostResponse> {
      try {
        const title = await resolveVideoTitle(config, request.videoId, request.title);
        const { job, message } = await store.enqueue({
          videoId: request.videoId,
          captionLanguage: request.captionLanguage,
          ...(request.url ? { url: request.url } : {}),
          ...(title ? { title } : {}),
          cacheReady: await cacheReady(config, request),
        });
        await logger.log({
          level: "info",
          component: "queue",
          event: "job.enqueued",
          message,
          requestId: request.id,
          jobId: job.id,
          videoId: job.videoId,
          details: { status: job.status, title: job.title, url: job.url },
        });
        if (job.status === "queued") {
          startQueue(config);
        }
        return { id: request.id, ok: true, type: "queueJob", job, message };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async getQueue(request: GetQueueRequest): Promise<HostResponse> {
      try {
        await store.recoverStaleRunningJobs();
        const queue = await enrichMissingQueueTitles(config, store);
        if (!queue.runningJobId && queue.jobs.some((job) => job.status === "queued")) {
          startQueue(config);
        }
        await logger.log({
          level: "info",
          component: "queue",
          event: "queue.read",
          message: "Read learning subtitle queue",
          requestId: request.id,
          details: {
            jobs: queue.jobs.length,
            runningJobId: queue.runningJobId,
            queued: queue.jobs.filter((job) => job.status === "queued").length,
          },
        });
        return { id: request.id, ok: true, type: "queue", queue };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async removeQueueJob(request: RemoveQueueJobRequest): Promise<HostResponse> {
      try {
        const queue = await store.remove(request.jobId);
        await logger.log({
          level: "info",
          component: "queue",
          event: "job.removed",
          message: "Removed learning subtitle queue job",
          requestId: request.id,
          jobId: request.jobId,
          details: { jobs: queue.jobs.length },
        });
        return { id: request.id, ok: true, type: "queue", queue };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
    async retryQueueJob(request: RetryQueueJobRequest): Promise<HostResponse> {
      try {
        const { job, message } = await store.retry(request.jobId);
        await logger.log({
          level: "info",
          component: "queue",
          event: "job.retry",
          message,
          requestId: request.id,
          jobId: job.id,
          videoId: job.videoId,
          details: { status: job.status, title: job.title },
        });
        startQueue(config);
        return { id: request.id, ok: true, type: "queueJob", job, message };
      } catch (error) {
        return queueErrorResponse(request.id, error);
      }
    },
  };
}
