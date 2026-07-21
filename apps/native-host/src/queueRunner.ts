import type { QueueJob } from "@fluent-frame/shared";
import type { Logger } from "./logger.js";
import type { QueueStore } from "./queueStore.js";

export type QueueRunner = {
  start(): Promise<void>;
  isRunning(): boolean;
};

export type QueueRunnerDeps = {
  store: QueueStore;
  logger?: Logger;
  processJob(job: QueueJob): Promise<void>;
  heartbeatIntervalMs?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Queue job failed";
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export function createQueueRunner({
  store,
  logger,
  processJob,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
}: QueueRunnerDeps): QueueRunner {
  let running = false;
  let recovered = false;

  function startHeartbeat(job: QueueJob): ReturnType<typeof setInterval> | undefined {
    if (heartbeatIntervalMs <= 0) {
      return undefined;
    }
    return setInterval(() => {
      void store.touchRunning(job.id).then((touched) => logger?.log({
        level: touched ? "debug" : "warn",
        component: "queueRunner",
        event: touched ? "job.heartbeat" : "job.heartbeatSkipped",
        message: touched ? "Refreshed queued learning subtitle job heartbeat" : "Skipped heartbeat because queued job is no longer running",
        jobId: job.id,
        videoId: job.videoId,
      })).catch((error: unknown) => logger?.log({
        level: "warn",
        component: "queueRunner",
        event: "job.heartbeatFailed",
        message: "Failed to refresh queued learning subtitle job heartbeat",
        jobId: job.id,
        videoId: job.videoId,
        details: { error },
      }));
    }, heartbeatIntervalMs);
  }

  async function start(): Promise<void> {
    if (running) {
      await logger?.log({
        level: "debug",
        component: "queueRunner",
        event: "runner.alreadyRunning",
        message: "Queue runner is already running",
      });
      return;
    }
    running = true;
    await logger?.log({
      level: "info",
      component: "queueRunner",
      event: "runner.started",
      message: "Queue runner started",
    });
    try {
      if (!recovered) {
        recovered = true;
        await store.recoverStaleRunningJobs();
        await logger?.log({
          level: "info",
          component: "queueRunner",
          event: "runner.recoveredStaleJobs",
          message: "Recovered stale running jobs before processing queue",
        });
      }
      while (true) {
        const job = await store.claimNext();
        if (!job) {
          await logger?.log({
            level: "info",
            component: "queueRunner",
            event: "runner.idle",
            message: "Queue runner found no queued jobs",
          });
          return;
        }
        await logger?.log({
          level: "info",
          component: "queueRunner",
          event: "job.claimed",
          message: "Claimed queued learning subtitle job",
          jobId: job.id,
          videoId: job.videoId,
          details: { title: job.title, status: job.status },
        });
        const heartbeat = startHeartbeat(job);
        try {
          await processJob(job);
          await store.markDone(job.id);
          await logger?.log({
            level: "info",
            component: "queueRunner",
            event: "job.completed",
            message: "Completed queued learning subtitle job",
            jobId: job.id,
            videoId: job.videoId,
          });
        } catch (error) {
          await store.markFailed(job.id, errorMessage(error));
          await logger?.log({
            level: "error",
            component: "queueRunner",
            event: "job.failed",
            message: "Queued learning subtitle job failed",
            jobId: job.id,
            videoId: job.videoId,
            details: { error },
          });
        } finally {
          if (heartbeat) {
            clearInterval(heartbeat);
          }
        }
      }
    } finally {
      running = false;
      await logger?.log({
        level: "info",
        component: "queueRunner",
        event: "runner.stopped",
        message: "Queue runner stopped",
      });
    }
  }

  return {
    start,
    isRunning() {
      return running;
    },
  };
}
