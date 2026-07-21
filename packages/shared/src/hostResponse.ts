import { isValidLearningSubtitleResult } from "./resultValidation.js";
import type { HostResponse, QueueJob, QueueState } from "./protocol.js";
import { parseCaptionLanguage, parsePersonalNotes, parseQueueJobId, parseYoutubeVideoId } from "./protocol.js";

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

function parseQueueJob(value: unknown): QueueJob {
  if (!isObject(value)) {
    throw new Error("Invalid native host response");
  }
  const status = value.status;
  if (status !== "queued" && status !== "running" && status !== "done" && status !== "failed" && status !== "skipped") {
    throw new Error("Invalid native host response");
  }
  const url = parseOptionalString(value.url, "Invalid native host response");
  const title = parseOptionalString(value.title, "Invalid native host response");
  const startedAt = parseOptionalString(value.startedAt, "Invalid native host response");
  const finishedAt = parseOptionalString(value.finishedAt, "Invalid native host response");
  const error = parseOptionalString(value.error, "Invalid native host response");
  const completedBatches = parseOptionalNonNegativeNumber(value.completedBatches, "Invalid native host response");
  const totalBatches = parseOptionalNonNegativeNumber(value.totalBatches, "Invalid native host response");
  return {
    id: parseQueueJobId(value.id),
    videoId: parseYoutubeVideoId(value.videoId),
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    captionLanguage: parseCaptionLanguage(value.captionLanguage),
    workflowVersion: parseNonEmptyString(value.workflowVersion, "Invalid native host response"),
    status,
    createdAt: parseNonEmptyString(value.createdAt, "Invalid native host response"),
    updatedAt: parseNonEmptyString(value.updatedAt, "Invalid native host response"),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(completedBatches !== undefined ? { completedBatches } : {}),
    ...(totalBatches !== undefined ? { totalBatches } : {}),
    ...(error ? { error } : {}),
  };
}

function parseQueueState(value: unknown): QueueState {
  if (!isObject(value) || value.paused !== false || !Array.isArray(value.jobs)) {
    throw new Error("Invalid native host response");
  }
  const runningJobId = value.runningJobId === undefined ? undefined : parseQueueJobId(value.runningJobId);
  return {
    paused: false,
    ...(runningJobId ? { runningJobId } : {}),
    jobs: value.jobs.map(parseQueueJob),
  };
}

export function parseHostResponse(expectedId: string, response: unknown): HostResponse {
  if (!isObject(response) || response.id !== expectedId || typeof response.ok !== "boolean") {
    throw new Error("Invalid native host response");
  }
  if (response.ok === false) {
    if (response.type === "error" && typeof response.code === "string" && typeof response.message === "string") {
      return response as HostResponse;
    }
    throw new Error("Invalid native host response");
  }
  if (response.type === "status" && response.installed === true && typeof response.workflowVersion === "string") {
    return response as HostResponse;
  }
  if (
    response.type === "health" &&
    isObject(response.health) &&
    typeof response.health.version === "string" &&
    typeof response.health.workflowVersion === "string" &&
    (response.health.agent === "codex" || response.health.agent === "claude") &&
    typeof response.health.cacheDir === "string" &&
    typeof response.health.notesFile === "string" &&
    typeof response.health.ytDlpPath === "string" &&
    isObject(response.health.checks)
  ) {
    return response as HostResponse;
  }
  if (
    response.type === "progress" &&
    isObject(response.progress) &&
    (response.progress.stage === "cache" ||
      response.progress.stage === "download" ||
      response.progress.stage === "agent" ||
      response.progress.stage === "codex" ||
      response.progress.stage === "done") &&
    typeof response.progress.message === "string"
  ) {
    return response as HostResponse;
  }
  if (
    response.type === "partialResult" &&
    isValidLearningSubtitleResult(response.result) &&
    typeof response.completedBatches === "number" &&
    typeof response.totalBatches === "number"
  ) {
    return response as HostResponse;
  }
  if (response.type === "result" && isValidLearningSubtitleResult(response.result)) {
    return response as HostResponse;
  }
  if (response.type === "personalNotes") {
    return { id: expectedId, ok: true, type: "personalNotes", notes: parsePersonalNotes(response.notes) };
  }
  if (response.type === "queue") {
    return { id: expectedId, ok: true, type: "queue", queue: parseQueueState(response.queue) };
  }
  if (response.type === "queueJob" && typeof response.message === "string") {
    return { id: expectedId, ok: true, type: "queueJob", message: response.message, job: parseQueueJob(response.job) };
  }
  if (response.type === "personalNotesSaved" || response.type === "cacheMiss" || response.type === "cacheCleared") {
    return response as HostResponse;
  }
  throw new Error("Invalid native host response");
}
