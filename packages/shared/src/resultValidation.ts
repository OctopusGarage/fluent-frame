import type { LearningSubtitleResult, PhraseExplanation, SubtitleCue, UsageNote } from "./protocol.js";

const difficulties = new Set(["basic", "useful", "advanced"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isValidUsageNote(value: unknown): value is UsageNote {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    typeof value.question === "string" &&
    typeof value.explanation === "string"
  );
}

export function isValidSubtitleCue(value: unknown): value is SubtitleCue {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    Number.isInteger(value.id) &&
    typeof value.startMs === "number" &&
    Number.isFinite(value.startMs) &&
    typeof value.endMs === "number" &&
    Number.isFinite(value.endMs) &&
    value.endMs > value.startMs &&
    typeof value.english === "string" &&
    typeof value.chinese === "string" &&
    isStringArray(value.phraseIds)
  );
}

export function isValidPhraseExplanation(value: unknown): value is PhraseExplanation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.cueId === "number" &&
    Number.isInteger(value.cueId) &&
    typeof value.phrase === "string" &&
    typeof value.meaningZh === "string" &&
    typeof value.explanationEn === "string" &&
    (value.noteZh === undefined || typeof value.noteZh === "string") &&
    (value.usageNotes === undefined || (Array.isArray(value.usageNotes) && value.usageNotes.every(isValidUsageNote))) &&
    typeof value.difficulty === "string" &&
    difficulties.has(value.difficulty)
  );
}

export function isValidLearningSubtitleResult(value: unknown): value is LearningSubtitleResult {
  if (
    !isRecord(value) ||
    typeof value.videoId !== "string" ||
    typeof value.sourceLanguage !== "string" ||
    typeof value.workflowVersion !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.subtitles) ||
    value.subtitles.length === 0 ||
    !value.subtitles.every(isValidSubtitleCue) ||
    !Array.isArray(value.phrases) ||
    !value.phrases.every(isValidPhraseExplanation)
  ) {
    return false;
  }
  const subtitleIds = new Set(value.subtitles.map((subtitle) => subtitle.id));
  const phraseIds = new Set(value.phrases.map((phrase) => phrase.id));
  return (
    value.phrases.every((phrase) => subtitleIds.has(phrase.cueId)) &&
    value.subtitles.every((subtitle) => subtitle.phraseIds.every((phraseId) => phraseIds.has(phraseId)))
  );
}

export function assertLearningSubtitleResult(value: unknown, message = "Invalid learning subtitle result"): asserts value is LearningSubtitleResult {
  if (!isValidLearningSubtitleResult(value)) {
    throw new Error(message);
  }
}
