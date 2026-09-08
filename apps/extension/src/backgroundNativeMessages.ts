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

type BackgroundMessage = Record<string, unknown>;
type NativeMessageHandler = (
  runtime: NativeMessageRuntime,
  message: BackgroundMessage,
  sendResponse: (response: HostResponse) => void,
) => true | false;

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

const nativeMessageHandlers: Record<string, NativeMessageHandler> = {
  getQueue: (runtime, _message, sendResponse) => {
    return forwardNativeRequest(runtime, createGetQueueRequest(), sendResponse);
  },
  listCachedVideos: (runtime, _message, sendResponse) => {
    return forwardNativeRequest(runtime, createListCachedVideosRequest(), sendResponse);
  },
  markCachedVideoWatched: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(
      runtime,
      () => createMarkCachedVideoWatchedRequest({
        videoId: message.videoId,
        captionLanguage: message.captionLanguage,
        title: message.title,
      }),
      sendResponse,
    );
  },
  enqueueVideo: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(
      runtime,
      () => createEnqueueVideoRequest({
        videoId: message.videoId,
        url: message.url,
        title: message.title,
      }),
      sendResponse,
    );
  },
  removeQueueJob: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(runtime, () => createRemoveQueueJobRequest(message.jobId), sendResponse);
  },
  retryQueueJob: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(runtime, () => createRetryQueueJobRequest(message.jobId), sendResponse);
  },
  healthCheck: (runtime, _message, sendResponse) => {
    return forwardNativeRequest(runtime, createHealthCheckRequest(), sendResponse);
  },
  getPersonalNotes: (runtime, _message, sendResponse) => {
    return forwardNativeRequest(runtime, createGetPersonalNotesRequest(), sendResponse);
  },
  savePersonalNotes: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(runtime, () => createSavePersonalNotesRequest(message.notes), sendResponse);
  },
  processCurrentVideo: (runtime, message, sendResponse) => {
    return forwardCreatedNativeRequest(runtime, () => createProcessVideoRequest(message.videoId), sendResponse);
  },
};

export function registerNativeMessageListener(runtime: NativeMessageRuntime): void {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundMessage(message)) {
      return false;
    }

    const messageType = typeof message.type === "string" ? message.type : "";
    const handler = nativeMessageHandlers[messageType];
    return handler ? handler(runtime, message, sendResponse) : false;
  });
}
