import type { RawSubtitleCue } from "@fluent-frame/shared";
import type { AgentOutput } from "./agentRunner.js";

const difficulties = new Set(["basic", "useful", "advanced"]);

function hasHanText(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function evaluateAgentOutputQuality(sourceCues: RawSubtitleCue[], output: AgentOutput): string[] {
  const failures: string[] = [];
  if (sourceCues.length === 0) {
    return failures;
  }

  const sourceById = new Map(sourceCues.map((cue) => [cue.id, cue]));
  const phraseIds = new Set(output.phrases.map((phrase) => phrase.id));
  const referencedPhraseIds = new Set(output.subtitles.flatMap((subtitle) => subtitle.phraseIds));

  for (const subtitle of output.subtitles) {
    const sourceCue = sourceById.get(subtitle.id);
    if (!sourceCue) {
      failures.push(`Subtitle ${subtitle.id} does not match a source cue`);
      continue;
    }
    if (subtitle.startMs !== sourceCue.startMs || subtitle.endMs !== sourceCue.endMs) {
      failures.push(`Subtitle ${subtitle.id} changed source timing`);
    }
    if (!subtitle.english.trim()) {
      failures.push(`Subtitle ${subtitle.id} is missing corrected English`);
    }
    if (!hasHanText(subtitle.chinese)) {
      failures.push(`Subtitle ${subtitle.id} is missing Chinese translation`);
    }
    if (subtitle.phraseIds.length === 0) {
      failures.push(`Subtitle ${subtitle.id} has no phrase IDs`);
    }
    for (const phraseId of subtitle.phraseIds) {
      if (!phraseIds.has(phraseId)) {
        failures.push(`Subtitle ${subtitle.id} references unknown phrase ${phraseId}`);
      }
    }
  }

  const correctedEnglish = output.subtitles.map((subtitle) => subtitle.english).join(" ").toLowerCase();
  if (correctedEnglish.includes("i gonna")) {
    failures.push("English correction left the obvious error 'I gonna'");
  }
  if (correctedEnglish.includes("need catch")) {
    failures.push("English correction left the obvious error 'need catch'");
  }

  for (const phrase of output.phrases) {
    if (!sourceById.has(phrase.cueId)) {
      failures.push(`Phrase ${phrase.id} points to unknown cue ${phrase.cueId}`);
    }
    if (!referencedPhraseIds.has(phrase.id)) {
      failures.push(`Phrase ${phrase.id} is not referenced by any subtitle`);
    }
    if (phrase.phrase.trim().length < 2) {
      failures.push(`Phrase ${phrase.id} is missing phrase text`);
    }
    if (!hasHanText(phrase.meaningZh)) {
      failures.push(`Phrase ${phrase.id} is missing Chinese meaning`);
    }
    if (wordCount(phrase.explanationEn) < 3) {
      failures.push(`Phrase ${phrase.id} is missing English explanation`);
    }
    if (!difficulties.has(phrase.difficulty)) {
      failures.push(`Phrase ${phrase.id} has invalid difficulty`);
    }
  }

  return failures;
}
