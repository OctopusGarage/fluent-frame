import type { QueueJob } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { ProcessVideoOutput } from "./processor.js";
import type { QueueStore } from "./queueStore.js";
import { runVideoProcessingPipeline } from "./videoProcessingPipeline.js";

export function isQueueReadyOutput(mode: ProcessVideoOutput["mode"]): boolean {
  return mode === "generated" || mode === "cache" || mode === "remoteCache";
}

export function createQueuedJobProcessor(config: HostConfig, logger: Logger, store: QueueStore) {
  return async function processQueuedJob(job: QueueJob): Promise<void> {
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
      await logger.log({
        level: "warn",
        component: "queueProcessor",
        event: "generation.fallback",
        message: "Queued learning subtitle generation produced a non-cacheable fallback",
        jobId: job.id,
        videoId: job.videoId,
        details: { mode: output.mode, fallbackReason: output.fallbackReason },
      });
      throw new Error(output.fallbackReason ?? "Learning subtitle generation failed");
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
  };
}
