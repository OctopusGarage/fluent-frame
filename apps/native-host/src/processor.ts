import { parseSrt, WORKFLOW_VERSION, type LearningSubtitleResult, type SubtitleCue } from "@fluent-frame/shared";
import type { AgentBatchProgress, AgentRunner } from "./agentRunner.js";
import { clearCachedResult, INVALID_CACHE_MESSAGE, readCachedResult, writeCachedResult } from "./cache.js";
import { assertAgentOutput } from "./resultValidation.js";

export type ProcessVideoDeps = {
  cacheDir: string;
  downloadCaptions: (videoId: string, captionLanguage: string) => Promise<string>;
  runAgent: AgentRunner;
  onPartialResult?: (result: LearningSubtitleResult, progress: AgentBatchProgress) => Promise<void> | void;
};

export type ProcessVideoOutput = {
  result: LearningSubtitleResult;
  cacheHit: boolean;
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
  const cached = await readCachedResult(deps.cacheDir, videoId, captionLanguage).catch(async (error: unknown) => {
    if (error instanceof Error && error.message === INVALID_CACHE_MESSAGE) {
      await clearCachedResult(deps.cacheDir, videoId, captionLanguage);
      return undefined;
    }
    throw error;
  });
  if (cached) {
    return { result: cached, cacheHit: true };
  }

  const captionText = await deps.downloadCaptions(videoId, captionLanguage);
  const fallbackSubtitles = sourceSubtitles(captionText);
  if (fallbackSubtitles.length === 0) {
    throw new Error("No subtitles parsed from downloaded captions");
  }
  const agentOutput = await deps.runAgent(captionText, {
    async onBatch(progress) {
      const partialResult = buildLearningSubtitleResult(videoId, captionLanguage, captionText, progress.output);
      await deps.onPartialResult?.(partialResult, progress);
    },
  }).catch(() => undefined);
  if (agentOutput) {
    assertAgentOutput(agentOutput);
  }
  const result: LearningSubtitleResult = agentOutput
    ? buildLearningSubtitleResult(videoId, captionLanguage, captionText, agentOutput)
    : {
        videoId,
        sourceLanguage: captionLanguage,
        workflowVersion: WORKFLOW_VERSION,
        generatedAt: new Date().toISOString(),
        subtitles: fallbackSubtitles,
        phrases: [],
      };
  if (agentOutput) {
    await writeCachedResult(deps.cacheDir, result);
  }
  return { result, cacheHit: false };
}
