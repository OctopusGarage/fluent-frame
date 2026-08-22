import type { PersonalNote, UsageNote } from "./protocol.js";
import { parseYoutubeVideoId } from "./protocolScalars.js";

function isSafeNoteId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,240}$/.test(value) && !value.includes("..");
}

function parseNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid personal notes");
  }
  return value;
}

function parseNonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid personal notes");
  }
  return value;
}

function parseUsageNote(value: unknown): UsageNote {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid personal notes");
  }
  const raw = value as Record<string, unknown>;
  return {
    term: parseNonEmptyString(raw.term),
    question: parseNonEmptyString(raw.question),
    explanation: parseNonEmptyString(raw.explanation),
  };
}

export function parseUsageNotes(value: unknown): UsageNote[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid personal notes");
  }
  return value.map(parseUsageNote);
}

function parsePersonalNote(value: unknown, parseYoutubeVideoId: (value: unknown) => string): PersonalNote {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid personal notes");
  }
  const raw = value as Record<string, unknown>;
  const id = parseNonEmptyString(raw.id);
  if (!isSafeNoteId(id)) {
    throw new Error("Invalid personal notes");
  }
  const usageNotes = parseUsageNotes(raw.usageNotes);
  return {
    id,
    videoId: parseYoutubeVideoId(raw.videoId),
    cueId: parseNonNegativeNumber(raw.cueId),
    startMs: parseNonNegativeNumber(raw.startMs),
    sentenceEnglish: parseNonEmptyString(raw.sentenceEnglish),
    sentenceChinese: parseNonEmptyString(raw.sentenceChinese),
    phrase: parseNonEmptyString(raw.phrase),
    meaningZh: parseNonEmptyString(raw.meaningZh),
    explanationEn: parseNonEmptyString(raw.explanationEn),
    ...(usageNotes ? { usageNotes } : {}),
    savedAt: parseNonEmptyString(raw.savedAt),
  };
}

export function parsePersonalNotes(value: unknown): PersonalNote[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid personal notes");
  }
  return value.map((note) => parsePersonalNote(note, parseYoutubeVideoId));
}
