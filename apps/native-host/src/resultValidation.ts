import type { PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";
import type { AgentOutput } from "./agentRunner.js";

const difficulties = new Set(["basic", "useful", "advanced"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidUsageNote(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    typeof value.question === "string" &&
    typeof value.explanation === "string"
  );
}

function isValidSubtitle(value: unknown): value is SubtitleCue {
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

function isValidPhrase(value: unknown): value is PhraseExplanation {
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

export function assertAgentOutput(value: unknown): asserts value is AgentOutput {
  if (
    !isRecord(value) ||
    !Array.isArray(value.subtitles) ||
    value.subtitles.length === 0 ||
    !value.subtitles.every(isValidSubtitle) ||
    !Array.isArray(value.phrases) ||
    value.phrases.length === 0 ||
    !value.phrases.every(isValidPhrase)
  ) {
    throw new Error("Invalid agent output");
  }

  const subtitleIds = new Set(value.subtitles.map((subtitle) => subtitle.id));
  const phraseIds = new Set(value.phrases.map((phrase) => phrase.id));
  if (
    !value.phrases.every((phrase) => subtitleIds.has(phrase.cueId)) ||
    !value.subtitles.every((subtitle) => subtitle.phraseIds.every((phraseId) => phraseIds.has(phraseId)))
  ) {
    throw new Error("Invalid agent output");
  }
}
