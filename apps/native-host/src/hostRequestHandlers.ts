import { WORKFLOW_VERSION, type HostRequest, type HostResponse } from "@fluent-frame/shared";
import { createCacheRequestHandler } from "./cacheRequestHandler.js";
import type { HostConfig } from "./config.js";
import { buildHealth } from "./hostHealth.js";
import { readPersonalNotes, writePersonalNotes } from "./notes.js";
import { handleProcessVideoRequest } from "./processVideoRequestHandler.js";
import { createQueueRequestHandler } from "./queueRequestHandler.js";
import type { Logger } from "./logger.js";

type HostRequestHandler<T extends HostRequest = HostRequest> = (
  request: T,
  context: { config: HostConfig; logger: Logger; emit?: (response: HostResponse) => void },
) => Promise<HostResponse>;

function notesErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "NOTES_ERROR",
    message: error instanceof Error ? error.message : "Notes operation failed",
  };
}

const requestHandlers = {
  async getStatus(request) {
    return { id: request.id, ok: true, type: "status", installed: true, workflowVersion: WORKFLOW_VERSION };
  },
  async healthCheck(request, { config }) {
    return { id: request.id, ok: true, type: "health", health: await buildHealth(config) };
  },
  async getCachedVideo(request, { config }) {
    return createCacheRequestHandler(config).getCachedVideo(request);
  },
  async getPersonalNotes(request, { config }) {
    try {
      return { id: request.id, ok: true, type: "personalNotes", notes: await readPersonalNotes(config.notesFile) };
    } catch (error) {
      return notesErrorResponse(request.id, error);
    }
  },
  async savePersonalNotes(request, { config }) {
    try {
      await writePersonalNotes(config.notesFile, request.notes);
      return { id: request.id, ok: true, type: "personalNotesSaved" };
    } catch (error) {
      return notesErrorResponse(request.id, error);
    }
  },
  async clearVideoCache(request, { config }) {
    return createCacheRequestHandler(config).clearVideoCache(request);
  },
  async processVideo(request, { config, logger, emit }) {
    return handleProcessVideoRequest(request, {
      config,
      logger,
      ...(emit ? { emit } : {}),
    });
  },
  async enqueueVideo(request, { config }) {
    return createQueueRequestHandler(config).enqueueVideo(request);
  },
  async getQueue(request, { config }) {
    return createQueueRequestHandler(config).getQueue(request);
  },
  async removeQueueJob(request, { config }) {
    return createQueueRequestHandler(config).removeQueueJob(request);
  },
  async retryQueueJob(request, { config }) {
    return createQueueRequestHandler(config).retryQueueJob(request);
  },
} satisfies { [Type in HostRequest["type"]]: HostRequestHandler<Extract<HostRequest, { type: Type }>> };

export function handleParsedRequest(
  request: HostRequest,
  context: { config: HostConfig; logger: Logger; emit?: (response: HostResponse) => void },
): Promise<HostResponse> {
  return requestHandlers[request.type](request as never, context);
}
