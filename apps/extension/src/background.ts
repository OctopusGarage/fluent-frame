import {
  parsePersonalNotes,
  parseYoutubeVideoId,
  type HostRequest,
  type HostResponse,
} from "@fluent-frame/shared";
import {
  createErrorResponse,
  createRequestId,
  normalizeExtensionError,
  normalizeNativeResponse,
  sendNativeRequest,
  streamNativeRequest,
  type ExtensionError,
  type RuntimePort,
} from "./nativeHostClient.js";

export type ExtensionRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  connectNative?(hostName: string): RuntimePort;
  sendNativeMessage(hostName: string, request: HostRequest, callback: (response: unknown) => void): void;
  onMessage: {
    addListener(
      callback: (message: unknown, sender: unknown, sendResponse: (response: HostResponse) => void) => boolean,
    ): void;
  };
  onConnect?: {
    addListener(callback: (port: RuntimePort) => void): void;
  };
};

export function createProcessVideoRequest(videoId: unknown, stream = false): HostRequest {
  return {
    id: createRequestId(),
    type: "processVideo",
    videoId: parseYoutubeVideoId(videoId),
    captionLanguage: "en",
    ...(stream ? { stream: true } : {}),
  };
}

function createGetPersonalNotesRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "getPersonalNotes",
  };
}

function createHealthCheckRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "healthCheck",
  };
}

function createSavePersonalNotesRequest(notes: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "savePersonalNotes",
    notes: parsePersonalNotes(notes),
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function registerStreamingPortListener(runtime: ExtensionRuntime): void {
  runtime.onConnect?.addListener((contentPort) => {
    if (contentPort.name !== "fluent-frame-process-video") {
      return;
    }
    let nativeStream: { disconnect(): void } | undefined;

    contentPort.onMessage.addListener((message: unknown) => {
      if (!isObject(message) || message.type !== "processCurrentVideoStream") {
        return;
      }
      let request: HostRequest;
      try {
        request = createProcessVideoRequest(message.videoId, true);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        contentPort.postMessage(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return;
      }
      nativeStream = streamNativeRequest(runtime, request, {
        onMessage(response) {
          contentPort.postMessage(response);
        },
        onDisconnectBeforeTerminal(requestId) {
          contentPort.postMessage(createErrorResponse(requestId, "NATIVE_HOST_DISCONNECTED", "Native host disconnected"));
        },
      });
    });

    contentPort.onDisconnect.addListener(() => {
      nativeStream?.disconnect();
      nativeStream = undefined;
    });
  });
}

export { createRequestId, normalizeExtensionError, normalizeNativeResponse };

export function registerBackgroundListener(runtime: ExtensionRuntime): void {
  registerStreamingPortListener(runtime);
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isObject(message) && message.type === "healthCheck") {
      const request = createHealthCheckRequest();
      sendNativeRequest(runtime, request).then(sendResponse, (error) => {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
      });
      return true;
    }

    if (isObject(message) && message.type === "getPersonalNotes") {
      const request = createGetPersonalNotesRequest();
      sendNativeRequest(runtime, request).then(sendResponse, (error) => {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
      });
      return true;
    }

    if (isObject(message) && message.type === "savePersonalNotes") {
      let request: HostRequest;
      try {
        request = createSavePersonalNotesRequest(message.notes);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }
      sendNativeRequest(runtime, request).then(sendResponse, (error) => {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
      });
      return true;
    }

    if (isObject(message) && message.type === "processCurrentVideo") {
      let request: HostRequest;
      try {
        request = createProcessVideoRequest(message.videoId);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }

      sendNativeRequest(runtime, request).then(sendResponse, (error) => {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
      });
      return true;
    }
    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerBackgroundListener(chrome.runtime);
}
