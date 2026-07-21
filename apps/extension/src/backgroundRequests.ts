import {
  parsePersonalNotes,
  parseQueueJobId,
  parseYoutubeVideoId,
  type HostRequest,
} from "@fluent-frame/shared";
import { createRequestId } from "./requestId.js";

export function createProcessVideoRequest(videoId: unknown, stream = false): HostRequest {
  return {
    id: createRequestId(),
    type: "processVideo",
    videoId: parseYoutubeVideoId(videoId),
    captionLanguage: "en",
    ...(stream ? { stream: true } : {}),
  };
}

export function extractYoutubeVideoIdFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = parsed.searchParams.get("v");
      return id ? parseYoutubeVideoId(id) : undefined;
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? parseYoutubeVideoId(id) : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
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

export function createEnqueueVideoRequest(input: {
  videoId: unknown;
  url?: unknown;
  title?: unknown;
}): HostRequest {
  const url = typeof input.url === "string" && input.url.trim() ? input.url.trim() : undefined;
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined;
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
