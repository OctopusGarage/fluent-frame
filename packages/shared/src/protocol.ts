import { parsePersonalNotes, parseUsageNotes } from "./personalNotes.js";
import { parseYoutubeVideoId } from "./protocolScalars.js";
import { parseQueueJobId, type QueueJob, type QueueState } from "./queue.js";
export { parseHostResponse } from "./hostResponse.js";
export { parsePersonalNotes, parseUsageNotes } from "./personalNotes.js";
export { parseYoutubeVideoId } from "./protocolScalars.js";
export { parseQueueJob, parseQueueJobId, parseQueueState } from "./queue.js";
export type { QueueJob, QueueJobStatus, QueueState } from "./queue.js";

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

export type AgentOutput = {
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

export type AgentName = "codex" | "claude";

export type HostHealth = {
  version: string;
  workflowVersion: string;
  agent: AgentName;
  cacheDir: string;
  notesFile: string;
  remoteCache: {
    enabled: boolean;
    provider?: "github";
    owner?: string;
    repo?: string;
    branch?: string;
    basePath?: string;
    writeEnabled?: boolean;
    tokenConfigured?: boolean;
  };
  ytDlpPath: string;
  codexPath?: string;
  claudePath?: string;
  checks: {
    ytDlp: boolean;
    codex: boolean;
    claude: boolean;
  };
};

export type HostProgress = {
  stage: "cache" | "download" | "agent" | "codex" | "done";
  message: string;
  completedBatches?: number;
  totalBatches?: number;
};

export type HostRequest =
  | { id: string; type: "getStatus" }
  | { id: string; type: "healthCheck" }
  | { id: string; type: "getCachedVideo"; videoId: string; captionLanguage: string }
  | { id: string; type: "processVideo"; videoId: string; captionLanguage: string; stream?: boolean }
  | { id: string; type: "clearVideoCache"; videoId: string; captionLanguage: string }
  | { id: string; type: "enqueueVideo"; videoId: string; captionLanguage: string; url?: string; title?: string }
  | { id: string; type: "getQueue" }
  | { id: string; type: "removeQueueJob"; jobId: string }
  | { id: string; type: "retryQueueJob"; jobId: string }
  | { id: string; type: "getPersonalNotes" }
  | { id: string; type: "savePersonalNotes"; notes: PersonalNote[] };

export type HostResponse =
  | { id: string; ok: true; type: "status"; installed: true; workflowVersion: string }
  | { id: string; ok: true; type: "health"; health: HostHealth }
  | { id: string; ok: true; type: "progress"; progress: HostProgress }
  | { id: string; ok: true; type: "partialResult"; result: LearningSubtitleResult; completedBatches: number; totalBatches: number }
  | { id: string; ok: true; type: "result"; result: LearningSubtitleResult }
  | { id: string; ok: true; type: "personalNotes"; notes: PersonalNote[] }
  | { id: string; ok: true; type: "personalNotesSaved" }
  | { id: string; ok: true; type: "queue"; queue: QueueState }
  | { id: string; ok: true; type: "queueJob"; job: QueueJob; message: string }
  | { id: string; ok: true; type: "cacheMiss" }
  | { id: string; ok: true; type: "cacheCleared" }
  | { id: string; ok: false; type: "error"; code: string; message: string };

export function parseCaptionLanguage(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(value)) {
    throw new Error("Invalid caption language");
  }
  return value;
}

function parseOptionalText(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return trimmed;
}

export function parseRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Invalid request ID");
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
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
  if (raw.type === "healthCheck") {
    return { id, type: "healthCheck" };
  }
  if (raw.type === "getPersonalNotes") {
    return { id, type: "getPersonalNotes" };
  }
  if (raw.type === "getQueue") {
    return { id, type: "getQueue" };
  }
  if (raw.type === "savePersonalNotes") {
    return { id, type: "savePersonalNotes", notes: parsePersonalNotes(raw.notes) };
  }
  if (raw.type === "enqueueVideo") {
    const url = parseOptionalText(raw.url, "queue URL");
    const title = parseOptionalText(raw.title, "queue title");
    return {
      id,
      type: "enqueueVideo",
      videoId: parseYoutubeVideoId(raw.videoId),
      captionLanguage: parseCaptionLanguage(raw.captionLanguage),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
    };
  }
  if (raw.type === "removeQueueJob") {
    return { id, type: "removeQueueJob", jobId: parseQueueJobId(raw.jobId) };
  }
  if (raw.type === "retryQueueJob") {
    return { id, type: "retryQueueJob", jobId: parseQueueJobId(raw.jobId) };
  }
  if (raw.type === "getCachedVideo") {
    return {
      id,
      type: "getCachedVideo",
      videoId: parseYoutubeVideoId(raw.videoId),
      captionLanguage: parseCaptionLanguage(raw.captionLanguage),
    };
  }
  if (raw.type === "processVideo") {
    return {
      id,
      type: "processVideo",
      videoId: parseYoutubeVideoId(raw.videoId),
      captionLanguage: parseCaptionLanguage(raw.captionLanguage),
      ...(raw.stream === true ? { stream: true } : {}),
    };
  }
  if (raw.type === "clearVideoCache") {
    return {
      id,
      type: "clearVideoCache",
      videoId: parseYoutubeVideoId(raw.videoId),
      captionLanguage: parseCaptionLanguage(raw.captionLanguage),
    };
  }
  throw new Error("Unsupported host request type");
}
