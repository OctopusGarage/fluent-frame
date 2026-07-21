import {
  isValidPhraseExplanation,
  isValidSubtitleCue,
  type PhraseExplanation,
  type SubtitleCue,
} from "@fluent-frame/shared";
import type { AgentOutput } from "./agentTypes.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertAgentOutput(value: unknown): asserts value is AgentOutput {
  if (
    !isRecord(value) ||
    !Array.isArray(value.subtitles) ||
    value.subtitles.length === 0 ||
    !value.subtitles.every(isValidSubtitleCue) ||
    !Array.isArray(value.phrases) ||
    value.phrases.length === 0 ||
    !value.phrases.every(isValidPhraseExplanation)
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
