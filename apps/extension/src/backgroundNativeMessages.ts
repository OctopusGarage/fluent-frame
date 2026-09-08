import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import {
  createEnqueueVideoRequest,
  createGetPersonalNotesRequest,
  createGetQueueRequest,
  createHealthCheckRequest,
  createListCachedVideosRequest,
  createMarkCachedVideoWatchedRequest,
  createProcessVideoRequest,
  createRemoveQueueJobRequest,
  createRetryQueueJobRequest,
  createSavePersonalNotesRequest,
} from "./backgroundRequests.js";
import {
  createExtensionErrorResponse,
  createErrorResponse,
  normalizeExtensionError,
  sendNativeRequest,
  type NativeClientRuntime,
} from "./nativeHostClient.js";
import { isBackgroundMessage } from "./backgroundMessages.js";

export type NativeMessageRuntime = NativeClientRuntime & {
  onMessage: {
    addListener(
      callback: (message: unknown, sender: unknown, sendResponse: (response: HostResponse) => void) => boolean,
    ): void;
  };
};

function forwardNativeRequest(
  runtime: NativeMessageRuntime,
  request: HostRequest,
  sendResponse: (response: HostResponse) => void,
): true {
  sendNativeRequest(runtime, request).then(sendResponse, (error) => {
    const extensionError = normalizeExtensionError(error);
    sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
  });
  return true;
}

function forwardCreatedNativeRequest(
  runtime: NativeMessageRuntime,
  createRequest: () => HostRequest,
  sendResponse: (response: HostResponse) => void,
): true | false {
  try {
    return forwardNativeRequest(runtime, createRequest(), sendResponse);
  } catch (error) {
    sendResponse(createExtensionErrorResponse(error));
    return false;
  }
}

export function registerNativeMessageListener(runtime: NativeMessageRuntime): void {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundMessage(message)) {
      return false;
    }

    if (message.type === "getQueue") {
      return forwardNativeRequest(runtime, createGetQueueRequest(), sendResponse);
    }

    if (message.type === "listCachedVideos") {
      return forwardNativeRequest(runtime, createListCachedVideosRequest(), sendResponse);
    }

    if (message.type === "markCachedVideoWatched") {
      return forwardCreatedNativeRequest(
        runtime,
        () => createMarkCachedVideoWatchedRequest({
          videoId: message.videoId,
          captionLanguage: message.captionLanguage,
          title: message.title,
        }),
        sendResponse,
      );
    }

    if (message.type === "enqueueVideo") {
      return forwardCreatedNativeRequest(
        runtime,
        () => createEnqueueVideoRequest({
          videoId: message.videoId,
          url: message.url,
          title: message.title,
        }),
        sendResponse,
      );
    }

    if (message.type === "removeQueueJob") {
      return forwardCreatedNativeRequest(runtime, () => createRemoveQueueJobRequest(message.jobId), sendResponse);
    }

    if (message.type === "retryQueueJob") {
      return forwardCreatedNativeRequest(runtime, () => createRetryQueueJobRequest(message.jobId), sendResponse);
    }

    if (message.type === "healthCheck") {
      return forwardNativeRequest(runtime, createHealthCheckRequest(), sendResponse);
    }

    if (message.type === "getPersonalNotes") {
      return forwardNativeRequest(runtime, createGetPersonalNotesRequest(), sendResponse);
    }

    if (message.type === "savePersonalNotes") {
      return forwardCreatedNativeRequest(runtime, () => createSavePersonalNotesRequest(message.notes), sendResponse);
    }

    if (message.type === "processCurrentVideo") {
      return forwardCreatedNativeRequest(runtime, () => createProcessVideoRequest(message.videoId), sendResponse);
    }

    return false;
  });
}
