import { parseYoutubeVideoId } from "./protocolScalars.js";

export type QueueJobStatus = "queued" | "running" | "done" | "failed" | "skipped";

export type QueueJob = {
  id: string;
  videoId: string;
  url?: string;
  title?: string;
  captionLanguage: string;
  workflowVersion: string;
  status: QueueJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  completedBatches?: number;
  totalBatches?: number;
  error?: string;
};

export type QueueState = {
  paused: false;
  runningJobId?: string;
  jobs: QueueJob[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function parseOptionalString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNonEmptyString(value, message);
}

function parseOptionalNonNegativeNumber(value: unknown, message: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}

export function parseQueueJobId(value: unknown): string {
  if (typeof value !== "string" || value.includes("..") || !/^[A-Za-z0-9_-]{11}:[a-z]{2,3}(-[A-Za-z0-9]+)?:[A-Za-z0-9_.:-]{1,120}$/.test(value)) {
    throw new Error("Invalid queue job ID");
  }
  return value;
}

function parseCaptionLanguage(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(value)) {
    throw new Error("Invalid caption language");
  }
  return value;
}

export function parseQueueJob(value: unknown, message = "Invalid queue job"): QueueJob {
  if (!isObject(value)) {
    throw new Error(message);
  }
  const status = value.status;
  if (status !== "queued" && status !== "running" && status !== "done" && status !== "failed" && status !== "skipped") {
    throw new Error(message);
  }
  try {
    const url = parseOptionalString(value.url, message);
    const title = parseOptionalString(value.title, message);
    const startedAt = parseOptionalString(value.startedAt, message);
    const finishedAt = parseOptionalString(value.finishedAt, message);
    const error = parseOptionalString(value.error, message);
    const completedBatches = parseOptionalNonNegativeNumber(value.completedBatches, message);
    const totalBatches = parseOptionalNonNegativeNumber(value.totalBatches, message);
    return {
      id: parseQueueJobId(value.id),
      videoId: parseYoutubeVideoId(value.videoId),
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      captionLanguage: parseCaptionLanguage(value.captionLanguage),
      workflowVersion: parseNonEmptyString(value.workflowVersion, message),
      status,
      createdAt: parseNonEmptyString(value.createdAt, message),
      updatedAt: parseNonEmptyString(value.updatedAt, message),
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(completedBatches !== undefined ? { completedBatches } : {}),
      ...(totalBatches !== undefined ? { totalBatches } : {}),
      ...(error ? { error } : {}),
    };
  } catch {
    throw new Error(message);
  }
}

export function parseQueueState(value: unknown, message = "Invalid queue state"): QueueState {
  if (!isObject(value) || value.paused !== false || !Array.isArray(value.jobs)) {
    throw new Error(message);
  }
  try {
    const runningJobId = value.runningJobId === undefined ? undefined : parseQueueJobId(value.runningJobId);
    return {
      paused: false,
      ...(runningJobId ? { runningJobId } : {}),
      jobs: value.jobs.map((job) => parseQueueJob(job, message)),
    };
  } catch {
    throw new Error(message);
  }
}
