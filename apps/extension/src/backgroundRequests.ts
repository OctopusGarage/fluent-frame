import {
  parseCaptionLanguage,
  parsePersonalNotes,
  parseQueueJobId,
  parseYoutubeVideoId,
  type HostRequest,
} from "@fluent-frame/shared";
import { createRequestId } from "./requestId.js";

const NATIVE_OPTIONAL_TEXT_MAX_LENGTH = 500;

function optionalNativeText(value: unknown, mode: "drop" | "truncate"): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= NATIVE_OPTIONAL_TEXT_MAX_LENGTH) {
    return trimmed;
  }
  return mode === "truncate" ? trimmed.slice(0, NATIVE_OPTIONAL_TEXT_MAX_LENGTH) : undefined;
}

export function createProcessVideoRequest(videoId: unknown, stream = false): HostRequest {
  return {
    id: createRequestId(),
    type: "processVideo",
    videoId: parseYoutubeVideoId(videoId),
    captionLanguage: "en",
    ...(stream ? { stream: true } : {}),
  };
}

export function createGetPersonalNotesRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "getPersonalNotes",
  };
}

export function createHealthCheckRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "healthCheck",
  };
}

export function createGetQueueRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "getQueue",
  };
}

export function createListCachedVideosRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "listCachedVideos",
  };
}

export function createMarkCachedVideoWatchedRequest(input: {
  videoId: unknown;
  captionLanguage?: unknown;
  title?: unknown;
}): HostRequest {
  const title = optionalNativeText(input.title, "truncate");
  return {
    id: createRequestId(),
    type: "markCachedVideoWatched",
    videoId: parseYoutubeVideoId(input.videoId),
    captionLanguage: parseCaptionLanguage(input.captionLanguage ?? "en"),
    ...(title ? { title } : {}),
  };
}

export function createEnqueueVideoRequest(input: {
  videoId: unknown;
  url?: unknown;
  title?: unknown;
}): HostRequest {
  const url = optionalNativeText(input.url, "drop");
  const title = optionalNativeText(input.title, "truncate");
  return {
    id: createRequestId(),
    type: "enqueueVideo",
    videoId: parseYoutubeVideoId(input.videoId),
    captionLanguage: "en",
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

export function createRemoveQueueJobRequest(jobId: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "removeQueueJob",
    jobId: parseQueueJobId(jobId),
  };
}

export function createRetryQueueJobRequest(jobId: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "retryQueueJob",
    jobId: parseQueueJobId(jobId),
  };
}

export function createSavePersonalNotesRequest(notes: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "savePersonalNotes",
    notes: parsePersonalNotes(notes),
  };
}
