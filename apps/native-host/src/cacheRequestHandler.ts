import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import { clearCachedResult, listCachedVideoSummaries, markCachedVideoWatched, readCachedResult } from "./cache.js";
import type { HostConfig } from "./config.js";

type GetCachedVideoRequest = Extract<HostRequest, { type: "getCachedVideo" }>;
type ClearVideoCacheRequest = Extract<HostRequest, { type: "clearVideoCache" }>;
type MarkCachedVideoWatchedRequest = Extract<HostRequest, { type: "markCachedVideoWatched" }>;

function cacheErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "CACHE_ERROR",
    message: error instanceof Error ? error.message : "Cache operation failed",
  };
}

export function createCacheRequestHandler(config: HostConfig) {
  return {
    async getCachedVideo(request: GetCachedVideoRequest): Promise<HostResponse> {
      try {
        const cached = await readCachedResult(config.cacheDir, request.videoId, request.captionLanguage);
        return cached
          ? { id: request.id, ok: true, type: "result", result: cached }
          : { id: request.id, ok: true, type: "cacheMiss" };
      } catch (error) {
        return cacheErrorResponse(request.id, error);
      }
    },
    async listCachedVideos(request: Extract<HostRequest, { type: "listCachedVideos" }>): Promise<HostResponse> {
      try {
        return { id: request.id, ok: true, type: "cachedVideos", videos: await listCachedVideoSummaries(config.cacheDir) };
      } catch (error) {
        return cacheErrorResponse(request.id, error);
      }
    },
    async markCachedVideoWatched(request: MarkCachedVideoWatchedRequest): Promise<HostResponse> {
      try {
        await markCachedVideoWatched(config.cacheDir, request.videoId, request.captionLanguage);
        return { id: request.id, ok: true, type: "cachedVideoWatched" };
      } catch (error) {
        return cacheErrorResponse(request.id, error);
      }
    },
    async clearVideoCache(request: ClearVideoCacheRequest): Promise<HostResponse> {
      try {
        await clearCachedResult(config.cacheDir, request.videoId, request.captionLanguage);
        return { id: request.id, ok: true, type: "cacheCleared" };
      } catch (error) {
        return cacheErrorResponse(request.id, error);
      }
    },
  };
}
