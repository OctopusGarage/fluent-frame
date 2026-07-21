import type { HostResponse, PersonalNote } from "@fluent-frame/shared";
import { createVideoLearningSession } from "./generationSession.js";
import { createRuntimeLearningGenerationClient, type ContentScriptRuntime } from "./learningGenerationClient.js";
import { createCoachUi, type PersonalNotesStore } from "./ui.js";
import { createYouTubePage } from "./youtubePage.js";
export type { ContentScriptRuntime };

type BootstrapWindow = Window & {
  __fluentFrameBootstrapped?: boolean;
  MutationObserver?: typeof MutationObserver;
};

const SYNC_INTERVAL_MS = 50;

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

  const ui = createCoachUi(doc, {
    notesStore: createNativeNotesStore(runtime),
    onJumpToMs(startMs) {
      const video = page.mainVideo();
      if (video) {
        video.currentTime = startMs / 1000;
      }
    },
  });
  const page = createYouTubePage(doc);
  ui.mount(doc.body);

  function reconcilePlayerUi(): void {
    const video = page.mainVideo();
    if (!video) {
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

  function bindPopupGenerateListener(): void {
    runtime.onMessage?.addListener((message: unknown) => {
      if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "popupGenerate") {
        return;
      }
      const videoId = page.currentVideoId();
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        return;
      }
      session.start(videoId);
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
  bindPopupGenerateListener();
  startPlayerObserver();
  startSyncLoop();
  startNavigationLoop();
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  bootstrapContentScript(document, window, chrome.runtime);
}
