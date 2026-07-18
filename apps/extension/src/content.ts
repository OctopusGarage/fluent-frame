import type { HostResponse, PersonalNote } from "@fluent-frame/shared";
import { createCoachUi, type PersonalNotesStore } from "./ui.js";
import { extractVideoIdFromUrl, findVideoElement } from "./video.js";

export type ContentScriptRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  onMessage?: {
    addListener(listener: (message: unknown) => void): void;
  };
  sendMessage(message: unknown, callback: (response: HostResponse | undefined) => void): void;
};

type BootstrapWindow = Window & {
  __fluentFrameBootstrapped?: boolean;
  MutationObserver?: typeof MutationObserver;
};

const SYNC_INTERVAL_MS = 50;
const GENERATION_HISTORY_KEY = "fluentFrame.generationHistory.v1";
const MAX_GENERATION_HISTORY = 20;

type GenerationHistoryRecord = {
  videoId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  status: "success" | "failed";
};

function readGenerationHistory(win: Window): GenerationHistoryRecord[] {
  try {
    const raw = win.localStorage?.getItem(GENERATION_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is GenerationHistoryRecord => {
      return Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as GenerationHistoryRecord).videoId === "string" &&
          typeof (item as GenerationHistoryRecord).startedAt === "string" &&
          typeof (item as GenerationHistoryRecord).finishedAt === "string" &&
          typeof (item as GenerationHistoryRecord).elapsedMs === "number" &&
          ((item as GenerationHistoryRecord).status === "success" || (item as GenerationHistoryRecord).status === "failed"),
      );
    });
  } catch {
    return [];
  }
}

function writeGenerationRecord(win: Window, record: GenerationHistoryRecord): void {
  try {
    const history = [record, ...readGenerationHistory(win)].slice(0, MAX_GENERATION_HISTORY);
    win.localStorage?.setItem(GENERATION_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Best-effort UX data; generation must not fail if storage is blocked.
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function estimateGenerationDuration(win: Window): string | undefined {
  const successes = readGenerationHistory(win)
    .filter((record) => record.status === "success" && record.elapsedMs > 0)
    .slice(0, 10);
  if (successes.length === 0) {
    return undefined;
  }
  const averageMs = successes.reduce((sum, record) => sum + record.elapsedMs, 0) / successes.length;
  return formatDuration(averageMs);
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

  let latestRequestSequence = 0;
  const ui = createCoachUi(doc, {
    notesStore: createNativeNotesStore(runtime),
    onJumpToMs(startMs) {
      const video = findVideoElement();
      if (video) {
        video.currentTime = startMs / 1000;
      }
    },
  });
  ui.mount(doc.body);

  function reconcilePlayerUi(): void {
    const video = findVideoElement();
    if (!video) {
      return;
    }
    ui.attachPlayerButton(video);
    ui.placeSubtitleOverlay(video);
    ui.sync(video.currentTime * 1000);
  }

  function requestProcessing(videoId: string): void {
    const requestSequence = latestRequestSequence + 1;
    latestRequestSequence = requestSequence;
    const startedMs = Date.now();
    const estimate = estimateGenerationDuration(win);
    ui.clearResult(estimate ? `Generating learning subtitles... ETA about ${estimate}` : "Generating learning subtitles... ETA after first run");
    try {
      runtime.sendMessage({ type: "processCurrentVideo", videoId }, (response: HostResponse | undefined) => {
        const currentVideoId = extractVideoIdFromUrl(doc.location.href);
        if (requestSequence !== latestRequestSequence || (currentVideoId && currentVideoId !== videoId)) {
          return;
        }
        const finishedMs = Date.now();
        const error = runtime.lastError;
        if (error) {
          writeGenerationRecord(win, {
            videoId,
            startedAt: new Date(startedMs).toISOString(),
            finishedAt: new Date(finishedMs).toISOString(),
            elapsedMs: Math.max(0, finishedMs - startedMs),
            status: "failed",
          });
          ui.setError(error.message ?? "Local helper failed");
          return;
        }
        if (!response || !response.ok) {
          writeGenerationRecord(win, {
            videoId,
            startedAt: new Date(startedMs).toISOString(),
            finishedAt: new Date(finishedMs).toISOString(),
            elapsedMs: Math.max(0, finishedMs - startedMs),
            status: "failed",
          });
          ui.setError(response?.message ?? "Local helper failed");
          return;
        }
        if (response.type === "result") {
          if (response.result.videoId !== videoId) {
            return;
          }
          const elapsedMs = Math.max(0, finishedMs - startedMs);
          writeGenerationRecord(win, {
            videoId,
            startedAt: new Date(startedMs).toISOString(),
            finishedAt: new Date(finishedMs).toISOString(),
            elapsedMs,
            status: "success",
          });
          ui.setResult(response.result, `Learning subtitles ready in ${formatDuration(elapsedMs)}`);
        }
      });
    } catch (error) {
      const currentVideoId = extractVideoIdFromUrl(doc.location.href);
      if (requestSequence !== latestRequestSequence || (currentVideoId && currentVideoId !== videoId)) {
        return;
      }
      ui.setError(error instanceof Error && error.message.includes("Extension context invalidated")
        ? "Extension was reloaded. Refresh this YouTube tab."
        : "Local helper failed");
    }
  }

  function bindGenerateButton(): void {
    const button = doc.getElementById("ff-generate");
    button?.addEventListener("click", () => {
      const videoId = extractVideoIdFromUrl(doc.location.href);
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        return;
      }
      requestProcessing(videoId);
    });
  }

  function bindPopupGenerateListener(): void {
    runtime.onMessage?.addListener((message: unknown) => {
      if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "popupGenerate") {
        return;
      }
      const videoId = extractVideoIdFromUrl(doc.location.href);
      if (!videoId) {
        ui.setError("Open a YouTube video first.");
        return;
      }
      requestProcessing(videoId);
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
    let lastVideoId = extractVideoIdFromUrl(doc.location.href);
    win.setInterval(() => {
      const currentVideoId = extractVideoIdFromUrl(doc.location.href);
      if (currentVideoId && currentVideoId !== lastVideoId) {
        lastVideoId = currentVideoId;
        latestRequestSequence += 1;
        ui.clearResult("Ready");
      }
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
