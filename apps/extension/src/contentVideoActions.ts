import type { HostResponse } from "@fluent-frame/shared";
import { errorMessage, isExtensionContextInvalidated } from "./chromeRuntimeErrors.js";
import type { ContentScriptRuntime } from "./learningGenerationClient.js";

export type EnqueueVideoInput = {
  videoId: string;
  url?: string;
  title?: string;
};

export type EnqueueVideoHandlers = {
  onSuccess?(message: string): void;
  onError?(message: string): void;
};

export type MarkVideoWatchedInput = {
  videoId: string;
  captionLanguage: string;
  title?: string;
};

export type RememberContextMenuLinkInput = {
  videoId: string;
  url: string;
  title?: string;
};

export type ContentVideoActions = {
  enqueueVideo(input: EnqueueVideoInput, handlers?: EnqueueVideoHandlers): void;
  markVideoWatched(input: MarkVideoWatchedInput): void;
  rememberContextMenuLink(input: RememberContextMenuLinkInput): void;
};

export function cleanVideoTitle(value: string | null | undefined): string | undefined {
  const title = value?.replace(/\s+/g, " ").trim();
  return title || undefined;
}

function runtimeSendErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  return isExtensionContextInvalidated(error)
    ? "Extension was reloaded. Refresh this YouTube tab."
    : message
      ? message
      : "Local helper failed";
}

export function createContentVideoActions(runtime: ContentScriptRuntime, deps: { fallbackTitle(): string | undefined }): ContentVideoActions {
  return {
    enqueueVideo(input, handlers = {}) {
      try {
        runtime.sendMessage({ type: "enqueueVideo", videoId: input.videoId, url: input.url, title: input.title }, (response: HostResponse | undefined) => {
          const error = runtime.lastError;
          if (error) {
            handlers.onError?.(error.message ?? "Local helper failed");
            return;
          }
          if (!response || !response.ok) {
            handlers.onError?.(response?.message ?? "Local helper failed");
            return;
          }
          handlers.onSuccess?.(response.type === "queueJob" ? response.message : "Queued");
        });
      } catch (error) {
        handlers.onError?.(runtimeSendErrorMessage(error));
      }
    },
    markVideoWatched(input) {
      try {
        const normalizedTitle = cleanVideoTitle(input.title ?? deps.fallbackTitle());
        runtime.sendMessage({
          type: "markCachedVideoWatched",
          videoId: input.videoId,
          captionLanguage: input.captionLanguage,
          ...(normalizedTitle ? { title: normalizedTitle } : {}),
        }, () => {});
      } catch {
        // Watch metadata is best-effort and must not interrupt subtitle playback.
      }
    },
    rememberContextMenuLink(input) {
      try {
        runtime.sendMessage({
          type: "rememberContextMenuLink",
          videoId: input.videoId,
          url: input.url,
          title: input.title,
        }, () => {});
      } catch {
        // The context menu has no immediate page UI; the native context-menu path validates the target again.
      }
    },
  };
}
