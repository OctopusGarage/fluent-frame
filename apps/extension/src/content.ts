import type { HostResponse, PersonalNote } from "@fluent-frame/shared";
import { createVideoLearningSession } from "./generationSession.js";
import { createRuntimeLearningGenerationClient, type ContentScriptRuntime } from "./learningGenerationClient.js";
import { createCoachUi, type PersonalNotesStore } from "./ui.js";
import { extractVideoIdFromUrl } from "./video.js";
import { createYouTubePage } from "./youtubePage.js";
export type { ContentScriptRuntime };

type BootstrapWindow = Window & {
  __fluentFrameBootstrapped?: boolean;
  MutationObserver?: typeof MutationObserver;
};

const SYNC_INTERVAL_MS = 50;

const VIDEO_CARD_SELECTOR = [
  "ytd-compact-video-renderer",
  "ytd-video-renderer",
  "ytd-rich-item-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-panel-video-renderer",
].join(",");

function cleanTitle(value: string | null | undefined): string | undefined {
  const title = value?.replace(/\s+/g, " ").trim();
  return title || undefined;
}

function titleForRightClickedVideo(anchor: HTMLAnchorElement): string | undefined {
  const card = anchor.closest(VIDEO_CARD_SELECTOR);
  const titleElement = card?.querySelector("#video-title, a#video-title, h3, h3 a, yt-formatted-string#video-title");
  return cleanTitle(titleElement?.textContent)
    ?? cleanTitle(anchor.getAttribute("title"))
    ?? cleanTitle(anchor.getAttribute("aria-label"))
    ?? cleanTitle(card?.querySelector("[title]")?.getAttribute("title"))
    ?? cleanTitle(card?.querySelector("[aria-label]")?.getAttribute("aria-label"));
}

function runtimeSendErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.includes("Extension context invalidated")
    ? "Extension was reloaded. Refresh this YouTube tab."
    : error instanceof Error
      ? error.message
      : "Local helper failed";
}

function createNativeNotesStore(runtime: ContentScriptRuntime): PersonalNotesStore {
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

export function bootstrapContentScript(doc: Document, win: Window, runtime: ContentScriptRuntime): void {
  const bootstrapWindow = win as BootstrapWindow;
  if (bootstrapWindow.__fluentFrameBootstrapped) {
    return;
  }
  bootstrapWindow.__fluentFrameBootstrapped = true;

  const page = createYouTubePage(doc);

  doc.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) {
      return;
    }
    let videoId: string | undefined;
    try {
      videoId = extractVideoIdFromUrl(anchor.href);
    } catch {
      return;
    }
    if (!videoId) {
      return;
    }
    try {
      runtime.sendMessage({
        type: "rememberContextMenuLink",
        videoId,
        url: anchor.href,
        title: titleForRightClickedVideo(anchor),
      }, () => {});
    } catch {
      // The context menu has no immediate page UI; the native context-menu path validates the target again.
    }
  }, true);

  function enqueueVideo(
    input: { videoId: string; url?: string; title?: string },
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

  function markVideoWatched(videoId: string, captionLanguage: string): void {
    try {
      const title = doc.title.trim();
      runtime.sendMessage({ type: "markCachedVideoWatched", videoId, captionLanguage, ...(title ? { title } : {}) }, () => {});
    } catch {
      // Watch metadata is best-effort and must not interrupt subtitle playback.
    }
  }

  const ui = createCoachUi(doc, {
    notesStore: createNativeNotesStore(runtime),
    onJumpToMs(startMs) {
      const video = page.mainVideo();
      if (video) {
        video.currentTime = startMs / 1000;
      }
    },
    onEnqueueVideo() {
      const videoId = page.currentVideoId();
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        return;
      }
      ui.setStatus("Adding video to queue...");
      enqueueVideo({ videoId, url: doc.location.href, title: doc.title }, {
        onSuccess(message) {
          ui.setStatus(message);
        },
        onError(message) {
          ui.setError(message);
        },
      });
    },
  });
  ui.mount(doc.body);

  function reconcilePlayerUi(): void {
    if (!page.currentVideoId()) {
      ui.attachPlayerButton();
      return;
    }
    const video = page.mainVideo();
    if (!video) {
      ui.attachPlayerButton();
      return;
    }
    ui.attachPlayerButton(video);
    ui.placeSubtitleOverlay(video);
    ui.sync(video.currentTime * 1000);
  }

  const session = createVideoLearningSession({
    doc,
    win,
    generationClient: createRuntimeLearningGenerationClient(runtime),
    ui,
    currentVideoId: page.currentVideoId,
    markVideoWatched,
    reconcilePlayerUi,
  });

  function bindGenerateButton(): void {
    const button = doc.getElementById("ff-generate");
    button?.addEventListener("click", () => {
      const videoId = page.currentVideoId();
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        return;
      }
      session.start(videoId);
    });
  }

  function bindPopupMessageListener(): void {
    runtime.onMessage?.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
      const acknowledge = (response: unknown): void => {
        if (typeof sendResponse === "function") {
          sendResponse(response);
        }
      };
      if (!message || typeof message !== "object") {
        return;
      }
      if ((message as { type?: unknown }).type === "popupTogglePanel") {
        ui.togglePanel();
        acknowledge({ ok: true });
        return true;
      }
      if ((message as { type?: unknown }).type === "popupResetUi") {
        ui.resetUiState();
        acknowledge({ ok: true });
        return true;
      }
      if ((message as { type?: unknown }).type !== "popupGenerate") {
        return;
      }
      const videoId = page.currentVideoId();
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        acknowledge({ ok: false, message: "Open a YouTube video first." });
        return true;
      }
      session.start(videoId);
      acknowledge({ ok: true });
      return true;
    });
  }

  function startSyncLoop(): void {
    win.setInterval(() => {
      reconcilePlayerUi();
    }, SYNC_INTERVAL_MS);
  }

  function startPlayerObserver(): void {
    const Observer = (win as BootstrapWindow).MutationObserver;
    if (!Observer) {
      return;
    }
    function isExtensionOwnedMutation(record: MutationRecord): boolean {
      const ElementCtor = doc.defaultView?.Element;
      if (!ElementCtor) {
        return false;
      }
      const target = record.target;
      if (target instanceof ElementCtor && target.closest("#ff-root,#ff-overlay,#ff-video-now,#ff-video-badge,#ff-panel")) {
        return true;
      }
      const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
      return changedNodes.length > 0 && changedNodes.every((node) => {
        return node instanceof ElementCtor && Boolean(node.closest("#ff-root,#ff-overlay,#ff-video-now,#ff-video-badge,#ff-panel"));
      });
    }
    const observer = new Observer((records) => {
      if (records.length > 0 && records.every(isExtensionOwnedMutation)) {
        return;
      }
      reconcilePlayerUi();
    });
    observer.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    reconcilePlayerUi();
  }

  function startNavigationLoop(): void {
    win.setInterval(() => {
      session.handleNavigation(page.currentVideoId());
    }, 500);
  }

  bindGenerateButton();
  bindPopupMessageListener();
  startPlayerObserver();
  startSyncLoop();
  startNavigationLoop();
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  bootstrapContentScript(document, window, chrome.runtime);
}
