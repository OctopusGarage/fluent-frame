import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import { createProcessVideoRequest } from "./backgroundRequests.js";
import {
  createErrorResponse,
  normalizeExtensionError,
  streamNativeRequest,
  type NativeClientRuntime,
  type RuntimePort,
} from "./nativeHostClient.js";
import { createRequestId } from "./requestId.js";

export type StreamingRuntime = NativeClientRuntime & {
  onConnect?: {
    addListener(callback: (port: RuntimePort) => void): void;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function createExtensionErrorResponse(error: unknown): HostResponse {
  const extensionError = normalizeExtensionError(error);
  return createErrorResponse(createRequestId(), extensionError.code, extensionError.message);
}

export function registerStreamingPortListener(runtime: StreamingRuntime): void {
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
        contentPort.postMessage(createExtensionErrorResponse(error));
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
