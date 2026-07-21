import { isValidLearningSubtitleResult } from "./resultValidation.js";
import type { HostResponse } from "./protocol.js";
import { parsePersonalNotes } from "./protocol.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
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
  if (response.type === "personalNotesSaved" || response.type === "cacheMiss" || response.type === "cacheCleared") {
    return response as HostResponse;
  }
  throw new Error("Invalid native host response");
}
