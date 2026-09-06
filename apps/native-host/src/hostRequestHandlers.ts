import { WORKFLOW_VERSION, type HostRequest, type HostResponse } from "@fluent-frame/shared";
import { createCacheRequestHandler } from "./cacheRequestHandler.js";
import type { HostConfig } from "./config.js";
import { buildHealth } from "./hostHealth.js";
import { createNotesRequestHandler } from "./notesRequestHandler.js";
import { handleProcessVideoRequest } from "./processVideoRequestHandler.js";
import { createQueueRequestHandler } from "./queueRequestHandler.js";
import type { Logger } from "./logger.js";

type HostRequestHandler<T extends HostRequest = HostRequest> = (
  request: T,
  context: HostRequestContext,
) => Promise<HostResponse>;
type HostRequestContext = { config: HostConfig; logger: Logger; emit?: (response: HostResponse) => void };
type CacheRequest = Extract<HostRequest, { type: "getCachedVideo" | "listCachedVideos" | "markCachedVideoWatched" | "clearVideoCache" }>;
type NotesRequest = Extract<HostRequest, { type: "getPersonalNotes" | "savePersonalNotes" }>;
type QueueRequest = Extract<HostRequest, { type: "enqueueVideo" | "getQueue" | "removeQueueJob" | "retryQueueJob" }>;

function handleCacheRequest(request: CacheRequest, { config }: HostRequestContext): Promise<HostResponse> {
  const handler = createCacheRequestHandler(config);
  switch (request.type) {
    case "getCachedVideo":
      return handler.getCachedVideo(request);
    case "listCachedVideos":
      return handler.listCachedVideos(request);
    case "markCachedVideoWatched":
      return handler.markCachedVideoWatched(request);
    case "clearVideoCache":
      return handler.clearVideoCache(request);
  }
}

function handleNotesRequest(request: NotesRequest, { config }: HostRequestContext): Promise<HostResponse> {
  const handler = createNotesRequestHandler(config);
  switch (request.type) {
    case "getPersonalNotes":
      return handler.getPersonalNotes(request);
    case "savePersonalNotes":
      return handler.savePersonalNotes(request);
  }
}

function handleQueueRequest(request: QueueRequest, { config }: HostRequestContext): Promise<HostResponse> {
  const handler = createQueueRequestHandler(config);
  switch (request.type) {
    case "enqueueVideo":
      return handler.enqueueVideo(request);
    case "getQueue":
      return handler.getQueue(request);
    case "removeQueueJob":
      return handler.removeQueueJob(request);
    case "retryQueueJob":
      return handler.retryQueueJob(request);
  }
}

const requestHandlers = {
  async getStatus(request) {
    return { id: request.id, ok: true, type: "status", installed: true, workflowVersion: WORKFLOW_VERSION };
  },
  async healthCheck(request, { config }) {
    return { id: request.id, ok: true, type: "health", health: await buildHealth(config) };
  },
  getCachedVideo: handleCacheRequest,
  listCachedVideos: handleCacheRequest,
  markCachedVideoWatched: handleCacheRequest,
  getPersonalNotes: handleNotesRequest,
  savePersonalNotes: handleNotesRequest,
  clearVideoCache: handleCacheRequest,
  async processVideo(request, { config, logger, emit }) {
    return handleProcessVideoRequest(request, {
      config,
      logger,
      ...(emit ? { emit } : {}),
    });
  },
  enqueueVideo: handleQueueRequest,
  getQueue: handleQueueRequest,
  removeQueueJob: handleQueueRequest,
  retryQueueJob: handleQueueRequest,
} satisfies { [Type in HostRequest["type"]]: HostRequestHandler<Extract<HostRequest, { type: Type }>> };

export function handleParsedRequest(
  request: HostRequest,
  context: HostRequestContext,
): Promise<HostResponse> {
  return requestHandlers[request.type](request as never, context);
}
