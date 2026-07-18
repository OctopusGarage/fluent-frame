import {
  NATIVE_HOST_NAME,
  parsePersonalNotes,
  parseYoutubeVideoId,
  type HostRequest,
  type HostResponse,
} from "@fluent-frame/shared";

export type ExtensionError = {
  code: string;
  message: string;
};

export type ExtensionRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  sendNativeMessage(hostName: string, request: HostRequest, callback: (response: unknown) => void): void;
  onMessage: {
    addListener(
      callback: (message: unknown, sender: unknown, sendResponse: (response: HostResponse) => void) => boolean,
    ): void;
  };
};

export function createRequestId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

export function normalizeExtensionError(error: unknown): ExtensionError {
  return {
    code: "EXTENSION_ERROR",
    message: error instanceof Error ? error.message : "Unknown extension error",
  };
}

function createErrorResponse(id: string, code: string, message: string): HostResponse {
  return { id, ok: false, type: "error", code, message };
}

export function createProcessVideoRequest(videoId: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "processVideo",
    videoId: parseYoutubeVideoId(videoId),
    captionLanguage: "en",
  };
}

function createGetPersonalNotesRequest(): HostRequest {
  return {
    id: createRequestId(),
    type: "getPersonalNotes",
  };
}

function createSavePersonalNotesRequest(notes: unknown): HostRequest {
  return {
    id: createRequestId(),
    type: "savePersonalNotes",
    notes: parsePersonalNotes(notes),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isLearningSubtitleResult(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.videoId === "string" &&
    typeof value.sourceLanguage === "string" &&
    typeof value.workflowVersion === "string" &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.subtitles) &&
    Array.isArray(value.phrases)
  );
}

export function normalizeNativeResponse(expectedId: string, response: unknown): HostResponse {
  if (!isObject(response) || response.id !== expectedId || typeof response.ok !== "boolean") {
    return createErrorResponse(expectedId, "INVALID_NATIVE_RESPONSE", "Invalid native host response");
  }

  if (response.ok === false) {
    if (response.type === "error" && typeof response.code === "string" && typeof response.message === "string") {
      return response as HostResponse;
    }
    return createErrorResponse(expectedId, "INVALID_NATIVE_RESPONSE", "Invalid native host response");
  }

  if (response.type === "status" && response.installed === true && typeof response.workflowVersion === "string") {
    return response as HostResponse;
  }

  if (
    response.type === "progress" &&
    isObject(response.progress) &&
    (response.progress.stage === "cache" ||
      response.progress.stage === "download" ||
      response.progress.stage === "codex" ||
      response.progress.stage === "done") &&
    typeof response.progress.message === "string"
  ) {
    return response as HostResponse;
  }

  if (response.type === "result" && isLearningSubtitleResult(response.result)) {
    return response as HostResponse;
  }

  if (response.type === "personalNotes") {
    try {
      return { id: expectedId, ok: true, type: "personalNotes", notes: parsePersonalNotes(response.notes) };
    } catch {
      return createErrorResponse(expectedId, "INVALID_NATIVE_RESPONSE", "Invalid native host response");
    }
  }

  if (response.type === "personalNotesSaved") {
    return response as HostResponse;
  }

  if (response.type === "cacheMiss" || response.type === "cacheCleared") {
    return response as HostResponse;
  }

  return createErrorResponse(expectedId, "INVALID_NATIVE_RESPONSE", "Invalid native host response");
}

function sendNativeRequest(runtime: ExtensionRuntime, request: HostRequest): Promise<HostResponse> {
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

export function registerBackgroundListener(runtime: ExtensionRuntime): void {
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
