import { isValidLearningSubtitleResult } from "./resultValidation.js";
import type { HostHealth, HostProgress, HostResponse } from "./protocol.js";
import { parsePersonalNotes } from "./personalNotes.js";
import { parseNonEmptyString } from "./protocolScalars.js";
import { parseQueueJob, parseQueueState } from "./queue.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
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

function parseRequiredNonNegativeNumber(value: unknown, message: string): number {
  const parsed = parseOptionalNonNegativeNumber(value, message);
  if (parsed === undefined) {
    throw new Error(message);
  }
  return parsed;
}

function parseProgressCache(value: unknown): HostProgress["cache"] {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isObject(value) ||
    typeof value.localResult !== "boolean" ||
    typeof value.remoteResult !== "boolean" ||
    typeof value.partialResult !== "boolean"
  ) {
    throw new Error("Invalid native host response");
  }
  const cachedBatches = parseRequiredNonNegativeNumber(value.cachedBatches, "Invalid native host response");
  const totalBatches = parseOptionalNonNegativeNumber(value.totalBatches, "Invalid native host response");
  return {
    localResult: value.localResult,
    remoteResult: value.remoteResult,
    partialResult: value.partialResult,
    cachedBatches,
    ...(totalBatches !== undefined ? { totalBatches } : {}),
  };
}

function parseRemoteCacheHealth(value: unknown): HostHealth["remoteCache"] {
  if (value === undefined) {
    return { enabled: false };
  }
  if (!isObject(value) || typeof value.enabled !== "boolean") {
    throw new Error("Invalid native host response");
  }
  if (!value.enabled) {
    return { enabled: false };
  }
  if (
    value.provider !== "github" ||
    typeof value.owner !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.branch !== "string" ||
    typeof value.basePath !== "string" ||
    typeof value.writeEnabled !== "boolean" ||
    typeof value.tokenConfigured !== "boolean"
  ) {
    throw new Error("Invalid native host response");
  }
  return {
    enabled: true,
    provider: "github",
    owner: value.owner,
    repo: value.repo,
    branch: value.branch,
    basePath: value.basePath,
    writeEnabled: value.writeEnabled,
    tokenConfigured: value.tokenConfigured,
  };
}

function parseProgress(value: unknown): HostProgress {
  if (
    !isObject(value) ||
    (value.stage !== "cache" &&
      value.stage !== "download" &&
      value.stage !== "agent" &&
      value.stage !== "codex" &&
      value.stage !== "done") ||
    typeof value.message !== "string"
  ) {
    throw new Error("Invalid native host response");
  }
  const completedBatches = parseOptionalNonNegativeNumber(value.completedBatches, "Invalid native host response");
  const totalBatches = parseOptionalNonNegativeNumber(value.totalBatches, "Invalid native host response");
  const activeBatch = parseOptionalNonNegativeNumber(value.activeBatch, "Invalid native host response");
  const cache = parseProgressCache(value.cache);
  return {
    stage: value.stage,
    message: value.message,
    ...(completedBatches !== undefined ? { completedBatches } : {}),
    ...(totalBatches !== undefined ? { totalBatches } : {}),
    ...(activeBatch !== undefined ? { activeBatch } : {}),
    ...(cache ? { cache } : {}),
  };
}

function parseResultMode(value: unknown): HostResponse extends infer Response
  ? Response extends { type: "result"; mode?: infer Mode } ? Mode | undefined : never
  : never {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "cache" ||
    value === "remoteCache" ||
    value === "generated" ||
    value === "partialFallback" ||
    value === "sourceFallback"
  ) {
    return value;
  }
  throw new Error("Invalid native host response");
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
    return {
      ...response,
      health: {
        ...response.health,
        remoteCache: parseRemoteCacheHealth(response.health.remoteCache),
      },
    } as HostResponse;
  }
  if (
    response.type === "progress" &&
    isObject(response.progress)
  ) {
    return { id: expectedId, ok: true, type: "progress", progress: parseProgress(response.progress) };
  }
  if (
    response.type === "partialResult" &&
    isValidLearningSubtitleResult(response.result)
  ) {
    return {
      id: expectedId,
      ok: true,
      type: "partialResult",
      result: response.result,
      completedBatches: parseRequiredNonNegativeNumber(response.completedBatches, "Invalid native host response"),
      totalBatches: parseRequiredNonNegativeNumber(response.totalBatches, "Invalid native host response"),
    };
  }
  if (response.type === "result" && isValidLearningSubtitleResult(response.result)) {
    const mode = parseResultMode(response.mode);
    if (response.cacheHit !== undefined && typeof response.cacheHit !== "boolean") {
      throw new Error("Invalid native host response");
    }
    if (response.fallbackReason !== undefined && typeof response.fallbackReason !== "string") {
      throw new Error("Invalid native host response");
    }
    return {
      id: expectedId,
      ok: true,
      type: "result",
      result: response.result,
      ...(mode ? { mode } : {}),
      ...(response.cacheHit === undefined ? {} : { cacheHit: response.cacheHit }),
      ...(typeof response.fallbackReason === "string" ? { fallbackReason: response.fallbackReason } : {}),
    };
  }
  if (response.type === "personalNotes") {
    return { id: expectedId, ok: true, type: "personalNotes", notes: parsePersonalNotes(response.notes) };
  }
  if (response.type === "queue") {
    return { id: expectedId, ok: true, type: "queue", queue: parseQueueState(response.queue, "Invalid native host response") };
  }
  if (response.type === "queueJob" && typeof response.message === "string") {
    return { id: expectedId, ok: true, type: "queueJob", message: response.message, job: parseQueueJob(response.job, "Invalid native host response") };
  }
  if (response.type === "personalNotesSaved" || response.type === "cacheMiss" || response.type === "cacheCleared") {
    return response as HostResponse;
  }
  throw new Error("Invalid native host response");
}
