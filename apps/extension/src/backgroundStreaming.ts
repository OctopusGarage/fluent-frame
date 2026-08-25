import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import { createProcessVideoRequest } from "./backgroundRequests.js";
import {
  createExtensionErrorResponse,
  createErrorResponse,
  streamNativeRequest,
  type NativeClientRuntime,
  type RuntimePort,
} from "./nativeHostClient.js";

export type StreamingRuntime = NativeClientRuntime & {
  onConnect?: {
    addListener(callback: (port: RuntimePort) => void): void;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function postToContentPort(contentPort: RuntimePort, response: HostResponse): boolean {
  try {
    contentPort.postMessage(response);
    return true;
  } catch {
    return false;
  }
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
        postToContentPort(contentPort, createExtensionErrorResponse(error));
        return;
      }
      nativeStream = streamNativeRequest(runtime, request, {
        onMessage(response) {
          if (!postToContentPort(contentPort, response)) {
            nativeStream?.disconnect();
            nativeStream = undefined;
          }
        },
        onDisconnectBeforeTerminal(requestId) {
          postToContentPort(contentPort, createErrorResponse(requestId, "NATIVE_HOST_DISCONNECTED", "Native host disconnected"));
        },
      });
    });

    contentPort.onDisconnect.addListener(() => {
      nativeStream?.disconnect();
      nativeStream = undefined;
    });
  });
}
