import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { createConfiguredRunner } from "./agentRunner.js";
import { downloadCaptions } from "./captionDownloader.js";
import type { HostConfig } from "./config.js";
import { processVideo, type ProcessVideoEvent, type ProcessVideoOutput } from "./processor.js";
import { createRemoteCacheProvider } from "./remoteCache.js";

export type VideoProcessingPipelineInput = {
  videoId: string;
  captionLanguage: string;
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
    ...(remoteCache ? { remoteCache } : {}),
    downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
    runAgent,
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.onPartialResult ? { onPartialResult: input.onPartialResult } : {}),
  });
}
