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
  context: { config: HostConfig; logger: Logger; emit?: (response: HostResponse) => void },
) => Promise<HostResponse>;

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
  async listCachedVideos(request, { config }) {
    return createCacheRequestHandler(config).listCachedVideos(request);
  },
  async markCachedVideoWatched(request, { config }) {
    return createCacheRequestHandler(config).markCachedVideoWatched(request);
  },
  async getPersonalNotes(request, { config }) {
    return createNotesRequestHandler(config).getPersonalNotes(request);
  },
  async savePersonalNotes(request, { config }) {
    return createNotesRequestHandler(config).savePersonalNotes(request);
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
