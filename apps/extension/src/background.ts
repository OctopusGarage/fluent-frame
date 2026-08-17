import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import {
  createEnqueueVideoRequest,
  createGetPersonalNotesRequest,
  createGetQueueRequest,
  createHealthCheckRequest,
  createProcessVideoRequest,
  createRemoveQueueJobRequest,
  createRetryQueueJobRequest,
  createSavePersonalNotesRequest,
} from "./backgroundRequests.js";
import {
  registerQueueContextMenus,
  rememberQueueContextMenuLink,
  type QueueContextMenuChromeApi,
} from "./backgroundQueueContextMenus.js";
import { registerStreamingPortListener, type StreamingRuntime } from "./backgroundStreaming.js";
import {
  createErrorResponse,
  normalizeExtensionError,
  sendNativeRequest,
  type NativeClientRuntime,
} from "./nativeHostClient.js";
import { createRequestId } from "./requestId.js";

export type ExtensionRuntime = NativeClientRuntime & StreamingRuntime & {
  onMessage: {
    addListener(
      callback: (message: unknown, sender: unknown, sendResponse: (response: HostResponse) => void) => boolean,
    ): void;
  };
};

type ExtensionChromeApi = {
  runtime: ExtensionRuntime & {
    onInstalled?: { addListener(callback: () => void): void };
    onStartup?: { addListener(callback: () => void): void };
  };
} & QueueContextMenuChromeApi;

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function createExtensionErrorResponse(error: unknown): HostResponse {
  const extensionError = normalizeExtensionError(error);
  return createErrorResponse(createRequestId(), extensionError.code, extensionError.message);
}

function forwardNativeRequest(
  runtime: ExtensionRuntime,
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
  runtime: ExtensionRuntime,
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

export function registerBackgroundListener(runtime: ExtensionRuntime): void {
  registerStreamingPortListener(runtime);
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isObject(message) && message.type === "rememberContextMenuLink") {
      sendResponse(rememberQueueContextMenuLink(sender, message));
      return false;
    }

    if (isObject(message) && message.type === "getQueue") {
      return forwardNativeRequest(runtime, createGetQueueRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "enqueueVideo") {
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

    if (isObject(message) && message.type === "removeQueueJob") {
      return forwardCreatedNativeRequest(runtime, () => createRemoveQueueJobRequest(message.jobId), sendResponse);
    }

    if (isObject(message) && message.type === "retryQueueJob") {
      return forwardCreatedNativeRequest(runtime, () => createRetryQueueJobRequest(message.jobId), sendResponse);
    }

    if (isObject(message) && message.type === "healthCheck") {
      return forwardNativeRequest(runtime, createHealthCheckRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "getPersonalNotes") {
      return forwardNativeRequest(runtime, createGetPersonalNotesRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "savePersonalNotes") {
      return forwardCreatedNativeRequest(runtime, () => createSavePersonalNotesRequest(message.notes), sendResponse);
    }

    if (isObject(message) && message.type === "processCurrentVideo") {
      return forwardCreatedNativeRequest(runtime, () => createProcessVideoRequest(message.videoId), sendResponse);
    }
    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerBackgroundListener(chrome.runtime);
  registerQueueContextMenus(chrome as ExtensionChromeApi);
}
