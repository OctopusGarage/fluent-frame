import type { HostResponse, PersonalNote } from "@fluent-frame/shared";
import { errorMessage, isExtensionContextInvalidated } from "./chromeRuntimeErrors.js";
import type { ContentScriptRuntime } from "./learningGenerationClient.js";
import type { PersonalNotesStore } from "./ui.js";

const VIDEO_CARD_SELECTOR = [
  "ytd-compact-video-renderer",
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-panel-video-renderer",
].join(",");

export function cleanTitle(value: string | null | undefined): string | undefined {
  const title = value?.replace(/\s+/g, " ").trim();
  return title || undefined;
}

export function titleForRightClickedVideo(anchor: HTMLAnchorElement): string | undefined {
  const card = anchor.closest(VIDEO_CARD_SELECTOR);
  const titleElement = card?.querySelector("#video-title, a#video-title, h3, h3 a, yt-formatted-string#video-title");
  return cleanTitle(titleElement?.textContent)
    ?? cleanTitle(anchor.getAttribute("title"))
    ?? cleanTitle(anchor.getAttribute("aria-label"))
    ?? cleanTitle(card?.querySelector("[title]")?.getAttribute("title"))
    ?? cleanTitle(card?.querySelector("[aria-label]")?.getAttribute("aria-label"));
}

function runtimeSendErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  return isExtensionContextInvalidated(error)
    ? "Extension was reloaded. Refresh this YouTube tab."
    : message
      ? message
      : "Local helper failed";
}

export function createNativeNotesStore(runtime: ContentScriptRuntime): PersonalNotesStore {
  return {
    load() {
      return new Promise((resolve, reject) => {
        runtime.sendMessage({ type: "getPersonalNotes" }, (response: HostResponse | undefined) => {
          const error = runtime.lastError;
          if (error) {
            reject(new Error(error.message ?? "Local helper failed"));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response?.message ?? "Local helper failed"));
            return;
          }
          resolve(response.type === "personalNotes" ? response.notes as PersonalNote[] : []);
        });
      });
    },
    save(notes) {
      return new Promise((resolve, reject) => {
        runtime.sendMessage({ type: "savePersonalNotes", notes }, (response: HostResponse | undefined) => {
          const error = runtime.lastError;
          if (error) {
            reject(new Error(error.message ?? "Local helper failed"));
            return;
          }
          if (!response || !response.ok) {
            reject(new Error(response?.message ?? "Local helper failed"));
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function rememberContextMenuLink(
  runtime: ContentScriptRuntime,
  input: { videoId: string; url: string; title?: string | undefined },
): void {
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
}

export function enqueueVideo(
  runtime: ContentScriptRuntime,
  input: { videoId: string; url?: string | undefined; title?: string | undefined },
  handlers: { onSuccess?(message: string): void; onError?(message: string): void } = {},
): void {
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
}

export function markVideoWatched(
  runtime: ContentScriptRuntime,
  input: { videoId: string; captionLanguage: string; title?: string | undefined },
): void {
  try {
    runtime.sendMessage({
      type: "markCachedVideoWatched",
      videoId: input.videoId,
      captionLanguage: input.captionLanguage,
      ...(input.title ? { title: input.title } : {}),
    }, () => {});
  } catch {
    // Watch metadata is best-effort and must not interrupt subtitle playback.
  }
}
