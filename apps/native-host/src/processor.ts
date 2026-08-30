import { assertAgentOutput, parseSrt, WORKFLOW_VERSION, type LearningSubtitleResult, type SubtitleCue } from "@fluent-frame/shared";
import type { AgentBatchProgress, AgentRunner } from "./agentTypes.js";
import {
  clearCachedPartialResult,
  clearCachedResult,
  readCachedPartialResult,
  readCacheEntry,
  writeCachedPartialResult,
  writeCachedResult,
  writeCachedVideoTitle,
} from "./cache.js";
import { prepareCaptionBatches } from "./agentBatcher.js";
import type { RemoteCacheProvider } from "./remoteCache.js";

export type ProcessVideoMode = "cache" | "remoteCache" | "generated" | "partialFallback" | "sourceFallback";

export type ProcessVideoEvent =
  | {
      type: "cacheStatus";
      localResult: boolean;
      remoteResult: boolean;
      partialResult: boolean;
      cachedBatches: number;
      totalBatches?: number;
    }
  | { type: "partialResult"; result: LearningSubtitleResult; completedBatches: number; totalBatches: number }
  | { type: "fallback"; mode: Extract<ProcessVideoMode, "partialFallback" | "sourceFallback">; reason: string };

export type ProcessVideoDeps = {
  cacheDir: string;
  title?: string;
  remoteCache?: RemoteCacheProvider;
  readCachedCaptions?: (videoId: string, captionLanguage: string) => Promise<string | undefined>;
  writeCachedCaptions?: (videoId: string, captionLanguage: string, captionText: string) => Promise<void>;
  downloadCaptions: (videoId: string, captionLanguage: string) => Promise<string>;
  runAgent: AgentRunner;
  onEvent?: (event: ProcessVideoEvent) => Promise<void> | void;
  onPartialResult?: (result: LearningSubtitleResult, progress: AgentBatchProgress) => Promise<void> | void;
  backfillRemoteCache?: (result: LearningSubtitleResult) => Promise<unknown>;
};

export type ProcessVideoOutput = {
  result: LearningSubtitleResult;
  cacheHit: boolean;
  mode: ProcessVideoMode;
  fallbackReason?: string;
};

function mergeWithSourceCues(captionText: string, subtitles: SubtitleCue[]): SubtitleCue[] {
  const subtitleById = new Map(subtitles.map((subtitle) => [subtitle.id, subtitle]));
  return parseSrt(captionText).map((sourceCue) => {
    const subtitle = subtitleById.get(sourceCue.id);
    return subtitle
      ? { ...subtitle, startMs: sourceCue.startMs, endMs: sourceCue.endMs }
      : {
          id: sourceCue.id,
          startMs: sourceCue.startMs,
          endMs: sourceCue.endMs,
          english: sourceCue.text,
          chinese: "",
          phraseIds: [],
        };
  });
}

function sourceSubtitles(captionText: string): SubtitleCue[] {
  return parseSrt(captionText).map((sourceCue) => ({
    id: sourceCue.id,
    startMs: sourceCue.startMs,
    endMs: sourceCue.endMs,
    english: sourceCue.text,
    chinese: "",
    phraseIds: [],
  }));
}

function buildLearningSubtitleResult(
  videoId: string,
  captionLanguage: string,
  captionText: string,
  agentOutput: { subtitles: SubtitleCue[]; phrases: LearningSubtitleResult["phrases"] } | undefined,
): LearningSubtitleResult {
  return {
    videoId,
    sourceLanguage: captionLanguage,
    workflowVersion: WORKFLOW_VERSION,
    generatedAt: new Date().toISOString(),
    subtitles: agentOutput ? mergeWithSourceCues(captionText, agentOutput.subtitles) : sourceSubtitles(captionText),
    phrases: agentOutput?.phrases ?? [],
  };
}

export async function processVideo(
  videoId: string,
  captionLanguage: string,
  deps: ProcessVideoDeps,
): Promise<ProcessVideoOutput> {
  const cached = await readCacheEntry(deps.cacheDir, videoId, captionLanguage);
  if (cached.status === "hit") {
    await writeCachedVideoTitle(deps.cacheDir, videoId, captionLanguage, deps.title).catch(() => undefined);
    await deps.onEvent?.({ type: "cacheStatus", localResult: true, remoteResult: false, partialResult: false, cachedBatches: 0 });
    return { result: cached.result, cacheHit: true, mode: "cache" };
  }
  if (cached.status === "corrupt") {
    await clearCachedResult(deps.cacheDir, videoId, captionLanguage);
  } else if (cached.status === "fatal") {
    throw cached.error;
  }

  const remoteResult = await deps.remoteCache?.readResult(videoId, captionLanguage).catch(() => undefined);
  if (remoteResult) {
    await deps.onEvent?.({ type: "cacheStatus", localResult: false, remoteResult: true, partialResult: false, cachedBatches: 0 });
    await writeCachedResult(deps.cacheDir, remoteResult);
    await writeCachedVideoTitle(deps.cacheDir, videoId, captionLanguage, deps.title).catch(() => undefined);
    return { result: remoteResult, cacheHit: true, mode: "remoteCache" };
  }

  const cachedCaptionText = await deps.readCachedCaptions?.(videoId, captionLanguage).catch(() => undefined);
  const captionText = cachedCaptionText ?? await deps.downloadCaptions(videoId, captionLanguage);
  const fallbackSubtitles = sourceSubtitles(captionText);
  if (fallbackSubtitles.length === 0) {
    throw new Error("No subtitles parsed from downloaded captions");
  }
  if (!cachedCaptionText) {
    await deps.writeCachedCaptions?.(videoId, captionLanguage, captionText).catch(() => undefined);
  }
  const cachedPartial = await readCachedPartialResult(deps.cacheDir, videoId, captionLanguage).catch(() => undefined);
  const totalBatches = prepareCaptionBatches(captionText).length;
  await deps.onEvent?.({
    type: "cacheStatus",
    localResult: false,
    remoteResult: false,
    partialResult: Boolean(cachedPartial),
    cachedBatches: cachedPartial?.completedBatches ?? 0,
    totalBatches,
  });
  let lastSuccessfulAgentOutput: Awaited<ReturnType<AgentRunner>> | undefined;
  if (cachedPartial) {
    lastSuccessfulAgentOutput = cachedPartial.output;
    await deps.onEvent?.({
      type: "partialResult",
      result: cachedPartial.result,
      completedBatches: cachedPartial.completedBatches,
      totalBatches: cachedPartial.totalBatches,
    });
  }
  const runnerOptions: Parameters<AgentRunner>[1] = {
    async onBatch(progress) {
      lastSuccessfulAgentOutput = progress.output;
      const partialResult = buildLearningSubtitleResult(videoId, captionLanguage, captionText, progress.output);
      await writeCachedPartialResult(deps.cacheDir, partialResult, progress).catch(() => undefined);
      await deps.onEvent?.({
        type: "partialResult",
        result: partialResult,
        completedBatches: progress.completedBatches,
        totalBatches: progress.totalBatches,
      });
      await deps.onPartialResult?.(partialResult, progress);
    },
  };
  if (cachedPartial) {
    runnerOptions.resumeFrom = cachedPartial;
  }
  const agentOutput = await deps.runAgent(captionText, runnerOptions).catch(async (error: unknown) => {
    const reason = error instanceof Error ? error.message : "Local agent failed";
    return { error: reason } as const;
  });
  const agentFailure = agentOutput && "error" in agentOutput ? agentOutput.error : undefined;
  const successfulAgentOutput = agentOutput && !("error" in agentOutput) ? agentOutput : undefined;
  const bestAgentOutput = successfulAgentOutput ?? lastSuccessfulAgentOutput;
  if (bestAgentOutput) {
    assertAgentOutput(bestAgentOutput);
  }
  const result: LearningSubtitleResult = bestAgentOutput
    ? buildLearningSubtitleResult(videoId, captionLanguage, captionText, bestAgentOutput)
    : {
        videoId,
        sourceLanguage: captionLanguage,
        workflowVersion: WORKFLOW_VERSION,
        generatedAt: new Date().toISOString(),
        subtitles: fallbackSubtitles,
        phrases: [],
      };
  if (successfulAgentOutput) {
    await writeCachedResult(deps.cacheDir, result);
    await writeCachedVideoTitle(deps.cacheDir, videoId, captionLanguage, deps.title).catch(() => undefined);
    await clearCachedPartialResult(deps.cacheDir, videoId, captionLanguage).catch(() => undefined);
    await deps.remoteCache?.writeResult(result).catch(() => undefined);
    await deps.backfillRemoteCache?.(result).catch(() => undefined);
  }
  const mode: ProcessVideoMode = successfulAgentOutput ? "generated" : bestAgentOutput ? "partialFallback" : "sourceFallback";
  if (agentFailure && mode !== "generated") {
    await deps.onEvent?.({ type: "fallback", mode, reason: agentFailure });
  }
  return { result, cacheHit: false, mode, ...(agentFailure && mode !== "generated" ? { fallbackReason: agentFailure } : {}) };
}
