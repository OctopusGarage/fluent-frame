import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { createConfiguredRunner } from "./agentRunner.js";
import { backfillRemoteCache } from "./cacheBackfill.js";
import { readCachedCaptions, writeCachedCaptions } from "./captionCache.js";
import { downloadCaptions } from "./captionDownloader.js";
import type { HostConfig } from "./config.js";
import { processVideo, type ProcessVideoEvent, type ProcessVideoOutput } from "./processor.js";
import { createRemoteCacheProvider } from "./remoteCache.js";

export type VideoProcessingPipelineInput = {
  videoId: string;
  captionLanguage: string;
  title?: string;
  onEvent?: (event: ProcessVideoEvent) => Promise<void> | void;
  onPartialResult?: (
    result: LearningSubtitleResult,
    progress: { completedBatches: number; totalBatches: number },
  ) => Promise<void> | void;
};

export async function runVideoProcessingPipeline(
  config: HostConfig,
  input: VideoProcessingPipelineInput,
): Promise<ProcessVideoOutput> {
  const runAgent = await createConfiguredRunner(config.agent, {
    codexPath: config.codexPath,
    claudePath: config.claudePath,
  });
  const remoteCache = createRemoteCacheProvider(config.remoteCache);
  return processVideo(input.videoId, input.captionLanguage, {
    cacheDir: config.cacheDir,
    ...(input.title ? { title: input.title } : {}),
    ...(remoteCache ? { remoteCache } : {}),
    readCachedCaptions: (videoId, captionLanguage) => readCachedCaptions(config.cacheDir, videoId, captionLanguage),
    writeCachedCaptions: (videoId, captionLanguage, captionText) => writeCachedCaptions(config.cacheDir, videoId, captionLanguage, captionText),
    downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
    runAgent,
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.onPartialResult ? { onPartialResult: input.onPartialResult } : {}),
    ...(remoteCache
      ? { backfillRemoteCache: (result: LearningSubtitleResult) => backfillRemoteCache({ cacheDir: config.cacheDir, remoteCache, syncedResults: [result] }) }
      : {}),
  });
}
