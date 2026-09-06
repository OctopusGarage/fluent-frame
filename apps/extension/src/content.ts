import {
  cleanTitle,
  createNativeNotesStore,
  enqueueVideo,
  markVideoWatched,
  rememberContextMenuLink,
  titleForRightClickedVideo,
} from "./contentNativeMessages.js";
import { createVideoLearningSession } from "./generationSession.js";
import { createRuntimeLearningGenerationClient, type ContentScriptRuntime } from "./learningGenerationClient.js";
import { createCoachUi } from "./ui.js";
import { extractVideoIdFromUrl } from "./video.js";
import { createYouTubePage } from "./youtubePage.js";
export type { ContentScriptRuntime };

type BootstrapWindow = Window & {
  __fluentFrameBootstrapped?: boolean;
  MutationObserver?: typeof MutationObserver;
};

const SYNC_INTERVAL_MS = 50;

export function bootstrapContentScript(doc: Document, win: Window, runtime: ContentScriptRuntime): void {
  const bootstrapWindow = win as BootstrapWindow;
  if (bootstrapWindow.__fluentFrameBootstrapped) {
    return;
  }
  bootstrapWindow.__fluentFrameBootstrapped = true;

  const page = createYouTubePage(doc);
  let lastMarkedVideoMetadataKey = "";

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
    const title = titleForRightClickedVideo(anchor);
    rememberContextMenuLink(runtime, {
      videoId,
      url: anchor.href,
      ...(title ? { title } : {}),
    });
  }, true);

  function markCurrentVideoMetadata(): void {
    const videoId = page.currentVideoId();
    const title = cleanTitle(doc.title);
    if (!videoId || !title) {
      return;
    }
    const key = `${videoId}:en:${title}`;
    if (key === lastMarkedVideoMetadataKey) {
      return;
    }
    lastMarkedVideoMetadataKey = key;
    markVideoWatched(runtime, { videoId, captionLanguage: "en", title });
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
      enqueueVideo(runtime, { videoId, url: doc.location.href, title: doc.title }, {
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
    markVideoWatched(videoId, captionLanguage) {
      const title = cleanTitle(doc.title);
      markVideoWatched(runtime, {
        videoId,
        captionLanguage,
        ...(title ? { title } : {}),
      });
    },
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
      markCurrentVideoMetadata();
    }, 500);
  }

  bindGenerateButton();
  bindPopupMessageListener();
  startPlayerObserver();
  startSyncLoop();
  markCurrentVideoMetadata();
  startNavigationLoop();
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  bootstrapContentScript(document, window, chrome.runtime);
}
