import type { HostResponse, LearningSubtitleResult } from "@fluent-frame/shared";

export type RuntimePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
};

export type ContentScriptRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  connect?(connectInfo?: { name?: string }): RuntimePort;
  onMessage?: {
    addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void | boolean): void;
  };
  sendMessage(message: unknown, callback: (response: HostResponse | undefined) => void): void;
};

export type LearningGenerationHandlers = {
  onProgress(progress: {
    message: string;
    completedBatches?: number;
    totalBatches?: number;
    activeBatch?: number;
    cache?: {
      localResult: boolean;
      remoteResult: boolean;
      partialResult: boolean;
      cachedBatches: number;
      totalBatches?: number;
    };
  }): void;
  onPartialResult(result: LearningSubtitleResult, progress: { completedBatches: number; totalBatches: number }): void;
  onResult(result: LearningSubtitleResult): void;
  onError(message: string): void;
  onDisconnect(): void;
};

export type ActiveLearningGeneration = {
  disconnect(): void;
};

export type LearningGenerationClient = {
  start(videoId: string, handlers: LearningGenerationHandlers): ActiveLearningGeneration;
};

function connectionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.includes("Extension context invalidated")
    ? "Extension was reloaded. Refresh this YouTube tab."
    : "Local helper failed";
}

function handleResponse(videoId: string, response: HostResponse | undefined, handlers: LearningGenerationHandlers): void {
  if (!response || !response.ok) {
    handlers.onError(response?.message ?? "Local helper failed");
    return;
  }
  if (response.type === "progress") {
    handlers.onProgress({
      message: response.progress.message,
      ...(response.progress.completedBatches === undefined ? {} : { completedBatches: response.progress.completedBatches }),
      ...(response.progress.totalBatches === undefined ? {} : { totalBatches: response.progress.totalBatches }),
      ...(response.progress.activeBatch === undefined ? {} : { activeBatch: response.progress.activeBatch }),
      ...(response.progress.cache === undefined ? {} : { cache: response.progress.cache }),
    });
    return;
  }
  if (response.type === "partialResult" && response.result.videoId === videoId) {
    handlers.onPartialResult(response.result, {
      completedBatches: response.completedBatches,
      totalBatches: response.totalBatches,
    });
    return;
  }
  if (response.type === "result" && response.result.videoId === videoId) {
    handlers.onResult(response.result);
  }
}

export function createRuntimeLearningGenerationClient(runtime: ContentScriptRuntime): LearningGenerationClient {
  return {
    start(videoId, handlers) {
      if (runtime.connect) {
        try {
          const port = runtime.connect({ name: "fluent-frame-process-video" });
          port.onMessage.addListener((message: unknown) => {
            handleResponse(videoId, message as HostResponse | undefined, handlers);
          });
          port.onDisconnect.addListener(() => {
            handlers.onDisconnect();
          });
          port.postMessage({ type: "processCurrentVideoStream", videoId });
          return {
            disconnect() {
              port.disconnect();
            },
          };
        } catch (error) {
          handlers.onError(connectionErrorMessage(error));
          return {
            disconnect() {},
          };
        }
      }
      try {
        runtime.sendMessage({ type: "processCurrentVideo", videoId }, (response: HostResponse | undefined) => {
          const error = runtime.lastError;
          if (error) {
            handlers.onError(error.message ?? "Local helper failed");
            return;
          }
          handleResponse(videoId, response, handlers);
        });
      } catch (error) {
        handlers.onError(connectionErrorMessage(error));
      }
      return {
        disconnect() {},
      };
    },
  };
}
