import {
  NATIVE_HOST_NAME,
  parseHostResponse,
  type HostRequest,
  type HostResponse,
} from "@fluent-frame/shared";
import { createRequestId } from "./requestId.js";

export type ExtensionError = {
  code: string;
  message: string;
};

export type RuntimePort = {
  name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(callback: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(callback: () => void): void;
  };
};

export type NativeClientRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  connectNative?(hostName: string): RuntimePort;
  sendNativeMessage(hostName: string, request: HostRequest, callback: (response: unknown) => void): void;
};

export type NativeStreamSink = {
  onMessage(response: HostResponse): void;
  onDisconnectBeforeTerminal(requestId: string): void;
};

export function normalizeExtensionError(error: unknown): ExtensionError {
  return {
    code: "EXTENSION_ERROR",
    message: error instanceof Error ? error.message : "Unknown extension error",
  };
}

export function createErrorResponse(id: string, code: string, message: string): HostResponse {
  return { id, ok: false, type: "error", code, message };
}

export function normalizeNativeResponse(expectedId: string, response: unknown): HostResponse {
  try {
    return parseHostResponse(expectedId, response);
  } catch {
    return createErrorResponse(expectedId, "INVALID_NATIVE_RESPONSE", "Invalid native host response");
  }
}

export function sendNativeRequest(runtime: NativeClientRuntime, request: HostRequest): Promise<HostResponse> {
  return new Promise((resolve) => {
    runtime.sendNativeMessage(NATIVE_HOST_NAME, request, (response) => {
      const error = runtime.lastError;
      if (error) {
        resolve(createErrorResponse(request.id, "NATIVE_HOST_UNAVAILABLE", error.message ?? "Native host unavailable"));
        return;
      }
      resolve(normalizeNativeResponse(request.id, response));
    });
  });
}

export function streamNativeRequest(
  runtime: NativeClientRuntime,
  request: HostRequest,
  sink: NativeStreamSink,
): { disconnect(): void } {
  if (!runtime.connectNative) {
    sink.onMessage(createErrorResponse(request.id, "NATIVE_HOST_UNAVAILABLE", "Native host streaming is unavailable"));
    return { disconnect() {} };
  }
  const nativePort = runtime.connectNative(NATIVE_HOST_NAME);
  let terminalResponseReceived = false;
  let closedByClient = false;
  nativePort.onMessage.addListener((nativeMessage: unknown) => {
    const response = normalizeNativeResponse(request.id, nativeMessage);
    if (response.type === "result" || response.type === "error") {
      terminalResponseReceived = true;
    }
    sink.onMessage(response);
  });
  nativePort.onDisconnect.addListener(() => {
    if (!closedByClient && !terminalResponseReceived) {
      sink.onDisconnectBeforeTerminal(request.id);
    }
  });
  nativePort.postMessage(request);
  return {
    disconnect() {
      closedByClient = true;
      nativePort.disconnect();
    },
  };
}

export { createRequestId };
