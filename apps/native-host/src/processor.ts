import { parseSrt, WORKFLOW_VERSION, type LearningSubtitleResult, type SubtitleCue } from "@fluent-frame/shared";
import type { AgentBatchProgress, AgentRunner } from "./agentTypes.js";
import { clearCachedResult, readCacheEntry, writeCachedResult } from "./cache.js";
import type { RemoteCacheProvider } from "./remoteCache.js";
import { assertAgentOutput } from "./resultValidation.js";

export type ProcessVideoMode = "cache" | "remoteCache" | "generated" | "partialFallback" | "sourceFallback";

export type ProcessVideoEvent =
  | { type: "partialResult"; result: LearningSubtitleResult; completedBatches: number; totalBatches: number }
  | { type: "fallback"; mode: Extract<ProcessVideoMode, "partialFallback" | "sourceFallback">; reason: string };

export type ProcessVideoDeps = {
  cacheDir: string;
  remoteCache?: RemoteCacheProvider;
  downloadCaptions: (videoId: string, captionLanguage: string) => Promise<string>;
  runAgent: AgentRunner;
  onEvent?: (event: ProcessVideoEvent) => Promise<void> | void;
  onPartialResult?: (result: LearningSubtitleResult, progress: AgentBatchProgress) => Promise<void> | void;
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
    return { result: cached.result, cacheHit: true, mode: "cache" };
  }
  if (cached.status === "corrupt") {
    await clearCachedResult(deps.cacheDir, videoId, captionLanguage);
  } else if (cached.status === "fatal") {
    throw cached.error;
  }

  const remoteResult = await deps.remoteCache?.readResult(videoId, captionLanguage).catch(() => undefined);
  if (remoteResult) {
    await writeCachedResult(deps.cacheDir, remoteResult);
    return { result: remoteResult, cacheHit: true, mode: "remoteCache" };
  }

  const captionText = await deps.downloadCaptions(videoId, captionLanguage);
  const fallbackSubtitles = sourceSubtitles(captionText);
  if (fallbackSubtitles.length === 0) {
    throw new Error("No subtitles parsed from downloaded captions");
  }
  let lastSuccessfulAgentOutput: Awaited<ReturnType<AgentRunner>> | undefined;
  const agentOutput = await deps.runAgent(captionText, {
    async onBatch(progress) {
      lastSuccessfulAgentOutput = progress.output;
      const partialResult = buildLearningSubtitleResult(videoId, captionLanguage, captionText, progress.output);
      await deps.onEvent?.({
        type: "partialResult",
        result: partialResult,
        completedBatches: progress.completedBatches,
        totalBatches: progress.totalBatches,
      });
      await deps.onPartialResult?.(partialResult, progress);
    },
  }).catch(async (error: unknown) => {
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
    await deps.remoteCache?.writeResult(result).catch(() => undefined);
  }
  const mode: ProcessVideoMode = successfulAgentOutput ? "generated" : bestAgentOutput ? "partialFallback" : "sourceFallback";
  if (agentFailure && mode !== "generated") {
    await deps.onEvent?.({ type: "fallback", mode, reason: agentFailure });
  }
  return { result, cacheHit: false, mode, ...(agentFailure && mode !== "generated" ? { fallbackReason: agentFailure } : {}) };
}
