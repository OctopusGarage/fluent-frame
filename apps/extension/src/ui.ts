import {
  type LearningSubtitleResult,
  type PersonalNote,
  type PhraseExplanation,
  type SubtitleCue,
} from "@fluent-frame/shared";
import { createDragController } from "./uiDrag.js";
import {
  renderLearningEventCard as createLearningEventCard,
  renderPersonalNoteCard,
  renderVideoNowCard,
} from "./uiRenderers.js";
import { compactProgressMessage, createCoachRoot } from "./uiTemplate.js";
import { selectCaptionWindow, selectLearningEventWindow, unique, VISIBLE_SENTENCE_COUNT } from "./uiState.js";

type LayoutMode = "panel" | "toolbar" | "drawer";

export type CoachUiOptions = {
  onJumpToMs?: (startMs: number) => void;
  onEnqueueVideo?: () => void;
  writeClipboard?: (text: string) => Promise<void> | void;
  notesStore?: PersonalNotesStore;
};

export type CoachUi = {
  mount(parent: Element): void;
  setStatus(message: string): void;
  setProgress(message?: string): void;
  setError(message: string): void;
  clearResult(message?: string): void;
  setResult(result: LearningSubtitleResult, message?: string): void;
  sync(currentMs: number): void;
  placeSubtitleOverlay(video?: HTMLVideoElement): void;
  attachPlayerButton(video?: HTMLVideoElement): void;
};

export type PersonalNotesStore = {
  load(): Promise<PersonalNote[]>;
  save(notes: PersonalNote[]): Promise<void>;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function createCoachUi(doc: Document, options: CoachUiOptions = {}): CoachUi {
  const root = createCoachRoot(doc);

  let result: LearningSubtitleResult | undefined;
  let sourceCues: SubtitleCue[] = [];
  let activeWindowKey = "";
  let personalNotes: PersonalNote[] = [];
  let attachedPlayer: HTMLElement | undefined;

  function byId<T extends HTMLElement>(id: string): T {
    const element = root.querySelector(`#${id}`) ?? doc.getElementById(id);
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

  function getNotesStore(): PersonalNotesStore {
    return options.notesStore ?? {
      load: () => Promise.resolve([]),
      save: () => Promise.resolve(),
    };
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

  function setLayout(layout: LayoutMode): void {
    root.dataset.layout = layout;
    root.querySelectorAll<HTMLButtonElement>("[data-layout-option]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layoutOption === layout));
    });
  }

  function findPlayer(video?: HTMLVideoElement): HTMLElement | undefined {
    const player = video?.closest(".html5-video-player")
      ?? doc.querySelector(".html5-video-player.playing-mode,.html5-video-player.paused-mode,.html5-video-player");
    return player instanceof HTMLElement ? player : undefined;
  }

  function isShortsPlayer(player: HTMLElement): boolean {
    return Boolean(player.closest("#shorts-player,#player-shorts-container") ?? doc.querySelector("#shorts-player,#player-shorts-container"));
  }

  function hasVisibleAd(player: HTMLElement): boolean {
    const adOverlay = player.querySelector(".ytp-ad-player-overlay");
    return adOverlay instanceof HTMLElement && !adOverlay.hidden;
  }

  function setNativeCaptionSuppression(player: HTMLElement | undefined, suppress: boolean): void {
    if (attachedPlayer && attachedPlayer !== player) {
      attachedPlayer.classList.remove("ff-hide-native-captions");
    }
    attachedPlayer = player;
    if (!player) {
      return;
    }
    player.classList.toggle("ff-hide-native-captions", suppress);
  }

  function updatePlayerState(video?: HTMLVideoElement): HTMLElement | undefined {
    const player = findPlayer(video);
    const adPlayback = Boolean(player && hasVisibleAd(player));
    root.dataset.adPlayback = String(adPlayback);
    if (player && isShortsPlayer(player)) {
      root.dataset.videoMode = "shorts";
    } else {
      delete root.dataset.videoMode;
    }
    setNativeCaptionSuppression(player, Boolean(result && root.dataset.overlayHidden !== "true" && !adPlayback));
    if (adPlayback) {
      activeWindowKey = "ad";
      renderCueWindow([]);
    } else if (activeWindowKey === "ad") {
      activeWindowKey = "";
    }
    return player;
  }

  function setStyle(element: HTMLElement, property: string, value: string): void {
    const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    if (element.style.getPropertyValue(cssProperty) !== value) {
      element.style.setProperty(cssProperty, value);
    }
  }

  function renderCueWindow(cues: SubtitleCue[], overlayCue: SubtitleCue | undefined = cues[0]): void {
    byId("ff-english").textContent = overlayCue?.english ?? "";
    byId("ff-chinese").textContent = overlayCue?.chinese ?? "";
    root.dataset.subtitleActive = String(Boolean(overlayCue?.english || overlayCue?.chinese));
    if (!result) {
      return;
    }
    const activePhraseIds = unique(cues.flatMap((cue) => cue.phraseIds));
    markActivePhrases(activePhraseIds);
  }

  function learningEventWindow(currentMs: number): PhraseExplanation[] {
    return selectLearningEventWindow(result, currentMs);
  }

  function renderCurrentLearningEvents(currentMs: number): void {
    const phrases = learningEventWindow(currentMs);
    byId("ff-current-phrase").replaceChildren(...phrases.map((phrase) => renderLearningEventCard(phrase, "current")));
    renderVideoNowEvents(phrases);
    markActivePhrases(phrases.map((phrase) => phrase.id));
  }

  function renderVideoNowEvents(phrases: PhraseExplanation[]): void {
    const videoNow = byId("ff-video-now");
    if (phrases.length === 0) {
      videoNow.replaceChildren();
      videoNow.hidden = true;
      return;
    }
    videoNow.replaceChildren(...phrases.map((phrase) => renderVideoNowCard(doc, phrase)));
  }

  function renderLearningEventCard(phrase: PhraseExplanation, variant: "current" | "history"): HTMLElement {
    const cue = result?.subtitles.find((subtitle) => subtitle.id === phrase.cueId);
    return createLearningEventCard(doc, {
      phrase,
      variant,
      cue,
      onJump: (startMs) => {
        options.onJumpToMs?.(startMs);
      },
      onSave: (cueToSave, phraseToSave) => {
        void addPersonalNote(cueToSave, phraseToSave);
      },
      onCopy: (text) => {
        void writeClipboard(text).then(() => {
          setStatusText("Phrase copied");
        });
      },
      onKnownChange: () => {},
    });
  }

  function markActivePhrases(activeIds: string[]): void {
    const active = new Set(activeIds);
    root.querySelectorAll<HTMLElement>(".ff-phrase-item").forEach((item) => {
      const isActive = Boolean(item.dataset.phraseId && active.has(item.dataset.phraseId));
      item.dataset.active = String(isActive);
    });
  }

  function renderPhraseList(nextResult: LearningSubtitleResult): void {
    const list = byId("ff-phrase-list");
    list.replaceChildren(...nextResult.phrases.map((phrase) => renderLearningEventCard(phrase, "history")));
  }

  function placeVideoNow(player: HTMLElement | undefined): void {
    const videoNow = byId("ff-video-now");
    const showInVideo = Boolean(
      player
        && result
        && root.dataset.layout !== "drawer"
        && root.dataset.panelCollapsed !== "true"
        && root.dataset.nowPaneHidden !== "true"
        && videoNow.childElementCount > 0,
    );
    if (showInVideo && player) {
      if (videoNow.parentElement !== player) {
        player.appendChild(videoNow);
      }
      videoNow.classList.add("ff-video-now-in-player");
      videoNow.hidden = false;
      if (root.dataset.videoNowDragged !== "true") {
        setStyle(videoNow, "left", "");
        setStyle(videoNow, "top", "96px");
        setStyle(videoNow, "right", "14px");
        setStyle(videoNow, "bottom", "auto");
      }
      return;
    }
    videoNow.hidden = true;
    videoNow.classList.remove("ff-video-now-in-player");
    if (videoNow.parentElement !== root) {
      root.appendChild(videoNow);
    }
  }

  function renderNotes(): void {
    const list = byId("ff-notes-list");
    if (personalNotes.length === 0) {
      list.replaceChildren();
      return;
    }
    list.replaceChildren(
      ...personalNotes.map((note) => renderPersonalNoteCard(doc, {
        note,
        onJump: (startMs) => {
          options.onJumpToMs?.(startMs);
        },
        onRemove: (id) => {
          void removePersonalNote(id);
        },
      })),
    );
  }

  function noteId(videoId: string, cue: SubtitleCue, phrase: PhraseExplanation | undefined): string {
    const rawPhraseId = phrase?.id ?? "subtitle";
    const safePhraseId = rawPhraseId.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120) || "phrase";
    return `${videoId}:${cue.id}:${safePhraseId}`;
  }

  async function addPersonalNote(cue: SubtitleCue, phrase: PhraseExplanation | undefined): Promise<void> {
    if (!result) {
      return;
    }
    const nextNote: PersonalNote = {
      id: noteId(result.videoId, cue, phrase),
      videoId: result.videoId,
      cueId: cue.id,
      startMs: cue.startMs,
      sentenceEnglish: normalizeText(cue.english),
      sentenceChinese: normalizeText(cue.chinese || phrase?.meaningZh || "Translation pending"),
      phrase: phrase?.phrase ?? normalizeText(cue.english),
      meaningZh: phrase?.meaningZh ?? normalizeText(cue.chinese || "Translation pending"),
      explanationEn: phrase?.explanationEn ?? "Subtitle sentence",
      ...(phrase?.usageNotes ? { usageNotes: phrase.usageNotes } : {}),
      savedAt: new Date().toISOString(),
    };
    const existingIndex = personalNotes.findIndex((note) => note.id === nextNote.id);
    personalNotes = existingIndex >= 0
      ? personalNotes.map((note, index) => (index === existingIndex ? { ...nextNote, savedAt: note.savedAt } : note))
      : [nextNote, ...personalNotes];
    renderNotes();
    setStatusText(existingIndex >= 0 ? "Note already saved" : "Adding note...");
    try {
      await getNotesStore().save(personalNotes);
      setStatusText(existingIndex >= 0 ? "Note already saved" : "Added to personal notes");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local helper failed";
      byId("ff-status").textContent = `Note not saved: ${message}`;
      root.setAttribute("data-error", "true");
    }
  }

  async function removePersonalNote(id: string): Promise<void> {
    personalNotes = personalNotes.filter((note) => note.id !== id);
    renderNotes();
    await getNotesStore().save(personalNotes);
    setStatusText("Removed from personal notes");
  }

  function loadPersonalNotes(): void {
    void getNotesStore().load().then((notes) => {
      if (personalNotes.length > 0) {
        return;
      }
      personalNotes = Array.isArray(notes) ? notes : [];
      renderNotes();
    }).catch(() => {
      if (personalNotes.length === 0) {
        personalNotes = [];
      }
      renderNotes();
    });
  }

  byId<HTMLButtonElement>("ff-toggle-overlay").addEventListener("click", () => {
    const hidden = root.dataset.overlayHidden !== "true";
    root.dataset.overlayHidden = String(hidden);
    byId("ff-overlay").hidden = hidden;
    const toggle = byId<HTMLButtonElement>("ff-toggle-overlay");
    const title = toggle.querySelector(".ff-command-title");
    const meta = toggle.querySelector(".ff-command-meta");
    if (title) {
      title.textContent = "Subtitles";
    }
    if (meta) {
      meta.textContent = hidden ? "Hidden" : "Visible";
    }
    toggle.setAttribute("aria-pressed", String(hidden));
  });

  byId<HTMLButtonElement>("ff-toggle-now").addEventListener("click", () => {
    const hidden = root.dataset.nowPaneHidden !== "true";
    root.dataset.nowPaneHidden = String(hidden);
    byId("ff-video-now").hidden = hidden;
    const toggle = byId<HTMLButtonElement>("ff-toggle-now");
    const meta = toggle.querySelector(".ff-command-meta");
    if (meta) {
      meta.textContent = hidden ? "Hidden" : "Visible";
    }
    toggle.setAttribute("aria-pressed", String(hidden));
  });

  byId<HTMLButtonElement>("ff-video-badge").addEventListener("click", () => {
    const collapsed = root.dataset.panelCollapsed !== "true";
    root.dataset.panelCollapsed = String(collapsed);
    byId("ff-video-now").hidden = collapsed;
    if (!collapsed) {
      byId("ff-panel").removeAttribute("aria-hidden");
      return;
    }
    byId("ff-panel").setAttribute("aria-hidden", "true");
  });

  byId<HTMLButtonElement>("ff-enqueue").addEventListener("click", () => {
    options.onEnqueueVideo?.();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-layout-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const layout = button.dataset.layoutOption;
      if (layout === "panel" || layout === "toolbar" || layout === "drawer") {
        setLayout(layout);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-now-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const size = button.dataset.nowSize;
      if (size !== "small" && size !== "medium" && size !== "large") {
        return;
      }
      root.dataset.nowSize = size;
      byId("ff-video-now").dataset.nowSize = size;
      root.querySelectorAll<HTMLButtonElement>("[data-now-size]").forEach((sizeButton) => {
        sizeButton.setAttribute("aria-pressed", String(sizeButton.dataset.nowSize === size));
      });
    });
  });

  createDragController({ doc, root, byId }).bind();

  return {
    mount(parent) {
      if (!doc.getElementById("ff-root")) {
        parent.appendChild(root);
        loadPersonalNotes();
      }
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
      result = undefined;
      sourceCues = [];
      activeWindowKey = "";
      root.dataset.hasResult = "false";
      byId("ff-panel").dataset.hasResult = "false";
      renderCueWindow([]);
      byId("ff-current-phrase").replaceChildren();
      byId("ff-video-now").replaceChildren();
      byId("ff-video-now").hidden = true;
      byId("ff-phrase-list").replaceChildren();
      this.setStatus(message);
      setProgressText(message);
    },
    setResult(nextResult, message = "Learning subtitles ready") {
      result = nextResult;
      sourceCues = nextResult.subtitles;
      activeWindowKey = "";
      root.dataset.hasResult = "true";
      byId("ff-panel").dataset.hasResult = "true";
      const initialWindow = sourceCues.slice(0, VISIBLE_SENTENCE_COUNT);
      renderPhraseList(nextResult);
      renderCueWindow(initialWindow);
      renderCurrentLearningEvents(initialWindow[0]?.startMs ?? 0);
      activeWindowKey = `${initialWindow[0]?.id ?? "none"}|${learningEventWindow(initialWindow[0]?.startMs ?? 0).map((phrase) => phrase.id).join("|")}`;
      this.setStatus(message);
      setProgressText(message);
    },
    sync(currentMs) {
      if (!result) {
        return;
      }
      const { activeCue: overlayCue, cues: window } = selectCaptionWindow(sourceCues, currentMs);
      const learningWindow = learningEventWindow(currentMs);
      const windowKey = `${overlayCue?.id ?? "none"}|${learningWindow.map((phrase) => phrase.id).join("|")}`;
      if (windowKey !== activeWindowKey) {
        activeWindowKey = windowKey;
        renderCueWindow(window, overlayCue);
        renderCurrentLearningEvents(currentMs);
      }
    },
    placeSubtitleOverlay(video) {
      if (!video || root.dataset.subtitleDragged === "true") {
        return;
      }
      const player = updatePlayerState(video);
      placeVideoNow(player);
      const overlay = byId("ff-overlay");
      overlay.hidden = root.dataset.overlayHidden === "true";
      if (player) {
        if (overlay.parentElement !== player) {
          player.appendChild(overlay);
        }
        overlay.classList.add("ff-overlay-in-player");
        setStyle(overlay, "width", "90%");
        setStyle(overlay, "left", "50%");
        setStyle(overlay, "right", "auto");
        setStyle(overlay, "top", "24px");
        setStyle(overlay, "bottom", "auto");
        setStyle(overlay, "transform", "translateX(-50%)");
        return;
      }
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      const width = Math.min(rect.width * 0.92, 920);
      const topSafeOffset = Math.max(18, Math.min(28, rect.height * 0.06));
      overlay.classList.remove("ff-overlay-in-player");
      setStyle(overlay, "width", `${Math.round(width)}px`);
      setStyle(overlay, "left", `${Math.round(rect.left + rect.width / 2)}px`);
      setStyle(overlay, "top", `${Math.round(rect.top + topSafeOffset)}px`);
      setStyle(overlay, "right", "auto");
      setStyle(overlay, "bottom", "auto");
      setStyle(overlay, "transform", "translateX(-50%)");
    },
    attachPlayerButton(video) {
      const badge = byId("ff-video-badge");
      const shortsControls = doc.querySelector("#right-controls");
      const controls = shortsControls ?? doc.querySelector(".ytp-right-controls");
      if (controls instanceof HTMLElement) {
        const insertBeforeElement = shortsControls
          ? controls.firstElementChild
          : controls.querySelector(".ytp-subtitles-button");
        const directInsertBeforeElement = insertBeforeElement?.parentElement === controls && insertBeforeElement !== badge
          ? insertBeforeElement
          : undefined;
        if (directInsertBeforeElement) {
          if (badge.nextElementSibling !== directInsertBeforeElement) {
            controls.insertBefore(badge, directInsertBeforeElement);
          }
        } else if (badge.parentElement !== controls || controls.firstElementChild !== badge) {
          controls.insertBefore(badge, controls.firstElementChild);
        }
        badge.classList.add("ff-in-player-controls");
        badge.classList.toggle("ff-in-shorts-controls", Boolean(shortsControls));
        setStyle(badge, "left", "");
        setStyle(badge, "top", "");
        setStyle(badge, "right", "");
        setStyle(badge, "bottom", "");
        return;
      }
      if (!video) {
        return;
      }
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      if (badge.parentElement !== root) {
        root.insertBefore(badge, root.firstChild);
      }
      badge.classList.remove("ff-in-player-controls");
      badge.classList.remove("ff-in-shorts-controls");
      setStyle(badge, "left", `${Math.round(rect.right - 76)}px`);
      setStyle(badge, "top", `${Math.round(rect.bottom - 46)}px`);
      setStyle(badge, "right", "auto");
      setStyle(badge, "bottom", "auto");
    },
  };
}
