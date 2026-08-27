import type { LearningSubtitleResult, PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";
import type { PersonalNotesController } from "./personalNotesController.js";
import {
  renderLearningEventCard,
  renderVideoNowCard,
} from "./uiRenderers.js";
import { selectCaptionWindow, selectLearningEventWindow, unique, VISIBLE_SENTENCE_COUNT } from "./uiState.js";

export type UiLearningView = {
  hasResult(): boolean;
  activeWindowKey(): string;
  setActiveWindowKey(value: string): void;
  clear(message?: string): void;
  setResult(result: LearningSubtitleResult, message?: string): void;
  sync(currentMs: number): void;
  renderCueWindowEmpty(): void;
};

export type UiLearningViewDeps = {
  doc: Document;
  root: HTMLElement;
  byId<T extends HTMLElement>(id: string): T;
  notesController: PersonalNotesController;
  onJumpToMs?: (startMs: number) => void;
  writeClipboard(text: string): Promise<void>;
  setStatus(message: string): void;
  setProgress(message?: string): void;
  applySubtitleLanguageMode(): void;
};

export function createUiLearningView(deps: UiLearningViewDeps): UiLearningView {
  let result: LearningSubtitleResult | undefined;
  let sourceCues: SubtitleCue[] = [];
  let activeWindowKey = "";

  function markActivePhrases(activeIds: string[]): void {
    const active = new Set(activeIds);
    deps.root.querySelectorAll<HTMLElement>(".ff-phrase-item").forEach((item) => {
      const isActive = Boolean(item.dataset.phraseId && active.has(item.dataset.phraseId));
      item.dataset.active = String(isActive);
    });
  }

  function renderCueWindow(cues: SubtitleCue[], overlayCue: SubtitleCue | undefined = cues[0]): void {
    deps.byId("ff-english").textContent = overlayCue?.english ?? "";
    deps.byId("ff-chinese").textContent = overlayCue?.chinese ?? "";
    deps.root.dataset.subtitleActive = String(Boolean(overlayCue?.english || overlayCue?.chinese));
    if (!result) {
      return;
    }
    const activePhraseIds = unique(cues.flatMap((cue) => cue.phraseIds));
    markActivePhrases(activePhraseIds);
  }

  function learningEventWindow(currentMs: number): PhraseExplanation[] {
    return selectLearningEventWindow(result, currentMs);
  }

  function renderLearningEvent(phrase: PhraseExplanation, variant: "current" | "history"): HTMLElement {
    const cue = result?.subtitles.find((subtitle) => subtitle.id === phrase.cueId);
    return renderLearningEventCard(deps.doc, {
      phrase,
      variant,
      cue,
      onJump: (startMs) => {
        deps.onJumpToMs?.(startMs);
      },
      onSave: (cueToSave, phraseToSave) => {
        if (result) {
          void deps.notesController.add({ videoId: result.videoId, cue: cueToSave, phrase: phraseToSave });
        }
      },
      onCopy: (text) => {
        void deps.writeClipboard(text).then(() => {
          deps.setStatus("Phrase copied");
        });
      },
      onKnownChange: () => {},
    });
  }

  function renderVideoNowEvents(phrases: PhraseExplanation[]): void {
    const videoNow = deps.byId("ff-video-now");
    if (phrases.length === 0) {
      videoNow.replaceChildren();
      videoNow.hidden = true;
      return;
    }
    videoNow.replaceChildren(...phrases.map((phrase) => renderVideoNowCard(deps.doc, phrase)));
    deps.applySubtitleLanguageMode();
  }

  function renderCurrentLearningEvents(currentMs: number): void {
    const phrases = learningEventWindow(currentMs);
    deps.byId("ff-current-phrase").replaceChildren(...phrases.map((phrase) => renderLearningEvent(phrase, "current")));
    renderVideoNowEvents(phrases);
    markActivePhrases(phrases.map((phrase) => phrase.id));
  }

  function renderPhraseList(nextResult: LearningSubtitleResult): void {
    deps.byId("ff-phrase-list").replaceChildren(
      ...nextResult.phrases.map((phrase) => renderLearningEvent(phrase, "history")),
    );
  }

  return {
    hasResult() {
      return Boolean(result);
    },
    activeWindowKey() {
      return activeWindowKey;
    },
    setActiveWindowKey(value) {
      activeWindowKey = value;
    },
    clear(message = "Ready") {
      result = undefined;
      sourceCues = [];
      activeWindowKey = "";
      deps.root.dataset.hasResult = "false";
      deps.byId("ff-panel").dataset.hasResult = "false";
      renderCueWindow([]);
      deps.byId("ff-current-phrase").replaceChildren();
      deps.byId("ff-video-now").replaceChildren();
      deps.byId("ff-video-now").hidden = true;
      deps.byId("ff-phrase-list").replaceChildren();
      deps.setStatus(message);
      deps.setProgress(message);
    },
    setResult(nextResult, message = "Learning subtitles ready") {
      result = nextResult;
      sourceCues = nextResult.subtitles;
      activeWindowKey = "";
      deps.root.dataset.hasResult = "true";
      deps.byId("ff-panel").dataset.hasResult = "true";
      const initialWindow = sourceCues.slice(0, VISIBLE_SENTENCE_COUNT);
      renderPhraseList(nextResult);
      renderCueWindow(initialWindow);
      renderCurrentLearningEvents(initialWindow[0]?.startMs ?? 0);
      activeWindowKey = `${initialWindow[0]?.id ?? "none"}|${learningEventWindow(initialWindow[0]?.startMs ?? 0).map((phrase) => phrase.id).join("|")}`;
      deps.setStatus(message);
      deps.setProgress(message);
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
    renderCueWindowEmpty() {
      renderCueWindow([]);
    },
  };
}
