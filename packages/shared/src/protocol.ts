export const NATIVE_HOST_NAME = "com.octopusgarage.fluent_frame";
export const WORKFLOW_VERSION = "2026-07-20-learning-cues-1";

export type Difficulty = "basic" | "useful" | "advanced";

export type UsageNote = {
  term: string;
  question: string;
  explanation: string;
};

export type SubtitleCue = {
  id: number;
  startMs: number;
  endMs: number;
  english: string;
  chinese: string;
  phraseIds: string[];
};

export type PhraseExplanation = {
  id: string;
  cueId: number;
  phrase: string;
  meaningZh: string;
  explanationEn: string;
  noteZh?: string;
  usageNotes?: UsageNote[];
  difficulty: Difficulty;
};

export type LearningSubtitleResult = {
  videoId: string;
  sourceLanguage: string;
  workflowVersion: string;
  generatedAt: string;
  subtitles: SubtitleCue[];
  phrases: PhraseExplanation[];
};

export type PersonalNote = {
  id: string;
  videoId: string;
  cueId: number;
  startMs: number;
  sentenceEnglish: string;
  sentenceChinese: string;
  phrase: string;
  meaningZh: string;
  explanationEn: string;
  usageNotes?: UsageNote[];
  savedAt: string;
};

export type HostProgress = {
  stage: "cache" | "download" | "codex" | "done";
  message: string;
};

export type HostRequest =
  | { id: string; type: "getStatus" }
  | { id: string; type: "getCachedVideo"; videoId: string; captionLanguage: string }
  | { id: string; type: "processVideo"; videoId: string; captionLanguage: string }
  | { id: string; type: "clearVideoCache"; videoId: string; captionLanguage: string }
  | { id: string; type: "getPersonalNotes" }
  | { id: string; type: "savePersonalNotes"; notes: PersonalNote[] };

export type HostResponse =
  | { id: string; ok: true; type: "status"; installed: true; workflowVersion: string }
  | { id: string; ok: true; type: "progress"; progress: HostProgress }
  | { id: string; ok: true; type: "result"; result: LearningSubtitleResult }
  | { id: string; ok: true; type: "personalNotes"; notes: PersonalNote[] }
  | { id: string; ok: true; type: "personalNotesSaved" }
  | { id: string; ok: true; type: "cacheMiss" }
  | { id: string; ok: true; type: "cacheCleared" }
  | { id: string; ok: false; type: "error"; code: string; message: string };

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

function parsePersonalNote(value: unknown): PersonalNote {
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
  return value.map(parsePersonalNote);
}

export function parseYoutubeVideoId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value)) {
    throw new Error("Invalid YouTube video ID");
  }
  return value;
}

export function parseCaptionLanguage(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(value)) {
    throw new Error("Invalid caption language");
  }
  return value;
}

export function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Invalid request ID");
  }
  return value;
}

export function parseHostRequest(value: unknown): HostRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Host request must be an object");
  }
  const raw = value as Record<string, unknown>;
  const id = parseRequestId(raw.id);
  if (raw.type === "getStatus") {
    return { id, type: "getStatus" };
  }
  if (raw.type === "getPersonalNotes") {
    return { id, type: "getPersonalNotes" };
  }
  if (raw.type === "savePersonalNotes") {
    return { id, type: "savePersonalNotes", notes: parsePersonalNotes(raw.notes) };
  }
  if (raw.type === "getCachedVideo" || raw.type === "processVideo" || raw.type === "clearVideoCache") {
    return {
      id,
      type: raw.type,
      videoId: parseYoutubeVideoId(raw.videoId),
      captionLanguage: parseCaptionLanguage(raw.captionLanguage),
    };
  }
  throw new Error("Unsupported host request type");
}
