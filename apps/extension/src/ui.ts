import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { createDragController } from "./uiDrag.js";
import { renderPersonalNoteCard } from "./uiRenderers.js";
import { createPersonalNotesController, type PersonalNotesStore } from "./personalNotesController.js";
import { createUiLearningView } from "./uiLearningView.js";
import { createUiLayoutController } from "./uiLayoutController.js";
import { createUiPlacementController } from "./uiPlacement.js";
import { isSubtitleLanguageMode, readUiState, writeUiState, type SubtitleLanguageMode } from "./uiPersistence.js";
import { compactProgressMessage, createCoachRoot } from "./uiTemplate.js";

export type CoachUiOptions = {
  onJumpToMs?: (startMs: number) => void;
  onEnqueueVideo?: () => void;
  writeClipboard?: (text: string) => Promise<void> | void;
  notesStore?: PersonalNotesStore;
};

export type CoachUi = {
  mount(parent: Element): void;
  togglePanel(): void;
  resetUiState(): void;
  setStatus(message: string): void;
  setProgress(message?: string): void;
  setError(message: string): void;
  clearResult(message?: string): void;
  setResult(result: LearningSubtitleResult, message?: string): void;
  sync(currentMs: number): void;
  placeSubtitleOverlay(video?: HTMLVideoElement): void;
  attachPlayerButton(video?: HTMLVideoElement): void;
};

export type { PersonalNotesStore } from "./personalNotesController.js";

export function createCoachUi(doc: Document, options: CoachUiOptions = {}): CoachUi {
  const root = createCoachRoot(doc);
  const panelToggleElement = root.querySelector("#ff-video-badge");
  if (!(panelToggleElement instanceof HTMLElement)) {
    throw new Error("Missing UI element ff-video-badge");
  }
  const panelToggle: HTMLElement = panelToggleElement;
  const overlayElement = root.querySelector("#ff-overlay");
  if (!(overlayElement instanceof HTMLElement)) {
    throw new Error("Missing UI element ff-overlay");
  }
  const overlay: HTMLElement = overlayElement;
  const videoNowElement = root.querySelector("#ff-video-now");
  if (!(videoNowElement instanceof HTMLElement)) {
    throw new Error("Missing UI element ff-video-now");
  }
  const videoNow: HTMLElement = videoNowElement;
  let subtitleLanguageMode: SubtitleLanguageMode = "bilingual";

  function byId<T extends HTMLElement>(id: string): T {
    const element = ({
      "ff-overlay": overlay,
      "ff-video-badge": panelToggle,
      "ff-video-now": videoNow,
    } as Record<string, HTMLElement | undefined>)[id] ?? root.querySelector(`#${id}`) ?? doc.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing UI element ${id}`);
    }
    return element as T;
  }

  function writeClipboard(text: string): Promise<void> {
    if (options.writeClipboard) {
      return Promise.resolve(options.writeClipboard(text));
    }
    return navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.resolve();
  }

  function setStatusText(message: string): void {
    byId("ff-status").textContent = message;
    root.removeAttribute("data-error");
  }

  function setProgressText(message?: string): void {
    const progress = byId("ff-progress");
    const nextMessage = compactProgressMessage(message);
    progress.textContent = nextMessage ?? "";
    progress.hidden = !nextMessage;
  }

  function applySubtitleLanguageMode(): void {
    root.dataset.subtitleLanguageMode = subtitleLanguageMode;
    const englishOnly = subtitleLanguageMode === "english";
    const toggle = byId<HTMLButtonElement>("ff-toggle-subtitle-language");
    toggle.setAttribute("aria-pressed", String(englishOnly));
    const meta = toggle.querySelector<HTMLElement>(".ff-command-meta");
    if (meta) {
      meta.textContent = englishOnly ? "English only" : "Bilingual";
    }
    byId("ff-chinese").hidden = englishOnly;
  }

  function persistSubtitleLanguageMode(): void {
    const current = readUiState(doc.defaultView);
    writeUiState(doc.defaultView, {
      ...current,
      subtitleLanguageMode,
    });
  }

  function renderNotes(notes: import("@fluent-frame/shared").PersonalNote[]): void {
    const list = byId("ff-notes-list");
    if (notes.length === 0) {
      list.replaceChildren();
      return;
    }
    list.replaceChildren(
      ...notes.map((note) => renderPersonalNoteCard(doc, {
        note,
        onJump: (startMs) => {
          options.onJumpToMs?.(startMs);
        },
        onRemove: (id) => {
          void notesController.remove(id);
        },
      })),
    );
  }

  const notesController = createPersonalNotesController({
    ...(options.notesStore ? { store: options.notesStore } : {}),
    render: renderNotes,
    setStatus: setStatusText,
    setError(message) {
      byId("ff-status").textContent = message;
      root.setAttribute("data-error", "true");
    },
  });
  const learningView = createUiLearningView({
    doc,
    root,
    byId,
    notesController,
    ...(options.onJumpToMs ? { onJumpToMs: options.onJumpToMs } : {}),
    writeClipboard,
    setStatus: setStatusText,
    setProgress: setProgressText,
    applySubtitleLanguageMode,
  });
  const layoutController = createUiLayoutController({
    win: doc.defaultView,
    root,
    panel: byId("ff-panel"),
    overlay,
    videoNow,
    panelToggle,
  });

  byId<HTMLButtonElement>("ff-toggle-overlay").addEventListener("click", () => {
    layoutController.toggleOverlay();
  });

  byId<HTMLButtonElement>("ff-toggle-now").addEventListener("click", () => {
    layoutController.toggleVideoNow();
  });

  byId<HTMLButtonElement>("ff-toggle-subtitle-language").addEventListener("click", () => {
    subtitleLanguageMode = subtitleLanguageMode === "english" ? "bilingual" : "english";
    applySubtitleLanguageMode();
    persistSubtitleLanguageMode();
  });

  panelToggle.addEventListener("click", () => {
    layoutController.togglePanel();
  });

  byId<HTMLButtonElement>("ff-hide-panel").addEventListener("click", () => {
    layoutController.setPanelCollapsed(true);
  });

  byId<HTMLButtonElement>("ff-reset-layout").addEventListener("click", () => {
    layoutController.reset();
  });

  byId<HTMLButtonElement>("ff-enqueue").addEventListener("click", () => {
    options.onEnqueueVideo?.();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-layout-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextLayout = button.dataset.layoutOption;
      if (nextLayout === "panel" || nextLayout === "toolbar" || nextLayout === "drawer") {
        layoutController.setLayout(nextLayout);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-now-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const size = button.dataset.nowSize;
      if (size !== "small" && size !== "medium" && size !== "large") {
        return;
      }
      layoutController.setNowSize(size);
    });
  });

  const savedUiState = readUiState(doc.defaultView);
  subtitleLanguageMode = isSubtitleLanguageMode(savedUiState.subtitleLanguageMode)
    ? savedUiState.subtitleLanguageMode
    : "bilingual";
  layoutController.applySaved();
  applySubtitleLanguageMode();

  createDragController({ doc, root, byId, onChange: layoutController.persist }).bind();
  const placement = createUiPlacementController({
    doc,
    root,
    overlay,
    videoNow,
    panelToggle,
    hasResult: learningView.hasResult,
    activeWindowKey: learningView.activeWindowKey,
    setActiveWindowKey(value) {
      learningView.setActiveWindowKey(value);
    },
    renderCueWindowEmpty() {
      learningView.renderCueWindowEmpty();
    },
  });

  return {
    mount(parent) {
      if (!doc.getElementById("ff-root")) {
        parent.appendChild(root);
        notesController.load();
      }
    },
    togglePanel() {
      layoutController.togglePanel();
    },
    resetUiState() {
      layoutController.reset();
    },
    setStatus(message) {
      setStatusText(message);
      setProgressText();
    },
    setProgress(message) {
      const progress = byId("ff-progress");
      progress.textContent = message ?? "";
      progress.hidden = !message;
    },
    setError(message) {
      byId("ff-status").textContent = message;
      setProgressText(message);
      root.setAttribute("data-error", "true");
    },
    clearResult(message = "Ready") {
      learningView.clear(message);
    },
    setResult(nextResult, message = "Learning subtitles ready") {
      learningView.setResult(nextResult, message);
    },
    sync(currentMs) {
      learningView.sync(currentMs);
    },
    placeSubtitleOverlay(video) {
      placement.placeSubtitleOverlay(video);
    },
    attachPlayerButton(video) {
      placement.attachPlayerButton(video);
    },
  };
}
