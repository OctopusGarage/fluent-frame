import {
  type LearningSubtitleResult,
  type PersonalNote,
  type PhraseExplanation,
  type SubtitleCue,
  type UsageNote,
} from "@fluent-frame/shared";

type LayoutMode = "panel" | "toolbar" | "drawer";
type DragTarget = "panel" | "subtitle" | "videoNow";

const VISIBLE_SENTENCE_COUNT = 3;

export type CoachUiOptions = {
  onJumpToMs?: (startMs: number) => void;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function findActiveCueIndex(cues: SubtitleCue[], currentMs: number): number {
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index];
    if (cue && cue.startMs <= currentMs && currentMs < cue.endMs) {
      return index;
    }
  }
  return -1;
}

function findCueWindow(cues: SubtitleCue[], activeIndex: number): SubtitleCue[] {
  if (activeIndex < 0) {
    return [];
  }
  const activeCue = cues[activeIndex];
  if (!activeCue) {
    return [];
  }
  const windowStart = Math.max(0, Math.min(activeIndex, cues.length - VISIBLE_SENTENCE_COUNT));
  const window = cues.slice(windowStart, windowStart + VISIBLE_SENTENCE_COUNT);
  while (window.length < VISIBLE_SENTENCE_COUNT && windowStart - (VISIBLE_SENTENCE_COUNT - window.length) >= 0) {
    const previousCue = cues[windowStart - (VISIBLE_SENTENCE_COUNT - window.length)];
    if (previousCue) {
      window.unshift(previousCue);
    } else {
      break;
    }
  }
  return window;
}

export function createCoachUi(doc: Document, options: CoachUiOptions = {}): CoachUi {
  const root = doc.createElement("section");
  root.id = "ff-root";
  root.dataset.overlayHidden = "false";
  root.dataset.layout = "panel";
  root.dataset.panelCollapsed = "false";
  root.dataset.hasResult = "false";
  root.dataset.nowPaneHidden = "false";
  root.dataset.nowSize = "medium";
  root.innerHTML = `
    <button id="ff-video-badge" type="button" aria-label="Open FluentFrame" title="FluentFrame">
      <span class="ff-badge-glyph" aria-hidden="true">
        <span class="ff-badge-spark"></span>
        <span class="ff-badge-letter">A</span>
      </span>
    </button>
    <div id="ff-overlay" aria-live="polite">
      <div class="ff-caption-card" aria-label="Drag learning subtitles">
        <div id="ff-english"></div>
        <div id="ff-chinese"></div>
      </div>
    </div>
    <aside id="ff-video-now" aria-label="Current learning events in video" data-now-size="medium" hidden></aside>
    <aside id="ff-panel" aria-label="FluentFrame">
      <div class="ff-header">
        <div class="ff-drag-handle" aria-label="Drag panel">
          <span aria-hidden="true"></span>
        </div>
        <div class="ff-brand">
          <span class="ff-brand-mark" aria-hidden="true">A</span>
          <div>
            <div class="ff-title">FluentFrame</div>
            <div class="ff-subtitle">Bilingual captions and learning notes</div>
          </div>
        </div>
        <div id="ff-status">Ready</div>
      </div>

      <button id="ff-generate" class="ff-command ff-primary" type="button" aria-label="Generate learning subtitles">
        <span class="ff-command-icon" aria-hidden="true">AI</span>
        <span>
          <span class="ff-command-title">Generate subtitles</span>
          <span class="ff-command-meta">Translate and explain this video</span>
        </span>
      </button>
      <div id="ff-progress" aria-live="polite" hidden></div>

      <div class="ff-control-row">
        <button id="ff-toggle-overlay" class="ff-quiet-button" type="button" aria-pressed="false">
          <span aria-hidden="true">CC</span>
          <span class="ff-command-title">Subtitles</span>
          <span class="ff-command-meta">Visible</span>
        </button>

        <button id="ff-toggle-now" class="ff-quiet-button" type="button" aria-pressed="false">
          <span aria-hidden="true">N</span>
          <span class="ff-command-title">Now pane</span>
          <span class="ff-command-meta">Visible</span>
        </button>

        <div class="ff-layout-switch" aria-label="Display style">
          <button type="button" data-layout-option="panel" aria-pressed="true">Panel</button>
          <button type="button" data-layout-option="toolbar" aria-pressed="false">Bar</button>
          <button type="button" data-layout-option="drawer" aria-pressed="false">Study</button>
        </div>

        <div class="ff-layout-switch" aria-label="Now pane text size">
          <button type="button" data-now-size="small" aria-pressed="false">Small</button>
          <button type="button" data-now-size="medium" aria-pressed="true">Medium</button>
          <button type="button" data-now-size="large" aria-pressed="false">Large</button>
        </div>
      </div>

      <div class="ff-section-label" data-section-label="now">Now</div>
      <div id="ff-current-phrase" aria-live="polite"></div>
      <div class="ff-section-label" data-section-label="history">History</div>
      <div id="ff-phrase-list"></div>
      <div class="ff-section-label" data-section-label="notes">Personal Notes</div>
      <div id="ff-notes-list" aria-live="polite"></div>
    </aside>
  `;

  let result: LearningSubtitleResult | undefined;
  let sourceCues: SubtitleCue[] = [];
  let activeWindowKey = "";
  let personalNotes: PersonalNote[] = [];
  let attachedPlayer: HTMLElement | undefined;
  let dragState:
    | {
        target: DragTarget;
        startMouseX: number;
        startMouseY: number;
        startLeft: number;
        startTop: number;
        width: number;
        height: number;
      }
    | undefined;

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
    const nextMessage = message?.startsWith("Generating learning subtitles... ETA about ")
      ? message.replace("Generating learning subtitles... ", "")
      : message === "Generating learning subtitles... ETA after first run"
        ? "ETA after first successful run"
        : message?.startsWith("Learning subtitles ready in ")
          ? message.replace("Learning subtitles ready in ", "Ready in ")
          : undefined;
    progress.textContent = nextMessage ?? "";
    progress.hidden = !nextMessage;
  }

  function setLayout(layout: LayoutMode): void {
    root.dataset.layout = layout;
    root.querySelectorAll<HTMLButtonElement>("[data-layout-option]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layoutOption === layout));
    });
  }

  function viewportSize(): { width: number; height: number } {
    const win = doc.defaultView;
    return {
      width: win?.innerWidth ?? doc.documentElement.clientWidth,
      height: win?.innerHeight ?? doc.documentElement.clientHeight,
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function moveDraggedElement(clientX: number, clientY: number): void {
    if (!dragState) {
      return;
    }
    const element = dragState.target === "panel"
      ? byId("ff-panel")
      : dragState.target === "videoNow"
        ? byId("ff-video-now")
        : byId("ff-overlay");
    const viewport = viewportSize();
    const nextLeft = clamp(dragState.startLeft + clientX - dragState.startMouseX, 8, viewport.width - dragState.width - 8);
    const nextTop = clamp(dragState.startTop + clientY - dragState.startMouseY, 8, viewport.height - dragState.height - 8);
    element.style.left = `${Math.round(nextLeft)}px`;
    element.style.top = `${Math.round(nextTop)}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    if (dragState.target === "subtitle") {
      element.style.transform = "none";
      root.dataset.subtitleDragged = "true";
    } else if (dragState.target === "videoNow") {
      root.dataset.videoNowDragged = "true";
    } else {
      root.dataset.dragged = "true";
    }
  }

  function endDrag(): void {
    dragState = undefined;
    root.removeAttribute("data-dragging");
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

  function findCueForPhrase(phrase: PhraseExplanation): SubtitleCue | undefined {
    return result?.subtitles.find((subtitle) => subtitle.id === phrase.cueId);
  }

  function learningEventWindow(currentMs: number): PhraseExplanation[] {
    if (!result || result.phrases.length === 0) {
      return [];
    }
    const events = result.phrases
      .map((phrase) => ({ phrase, cue: findCueForPhrase(phrase) }))
      .filter((event): event is { phrase: PhraseExplanation; cue: SubtitleCue } => Boolean(event.cue))
      .sort((left, right) => left.cue.startMs - right.cue.startMs);
    if (events.length === 0) {
      return [];
    }
    const activeIndex = findActiveCueIndex(sourceCues, currentMs);
    const anchorMs = activeIndex >= 0 ? sourceCues[activeIndex]?.startMs ?? currentMs : currentMs;
    const nearbyEvents = events.filter((event) => event.cue.endMs > anchorMs);
    const source = nearbyEvents.length > 0 ? nearbyEvents : events;
    const firstFutureIndex = source.findIndex((event) => event.cue.startMs >= anchorMs);
    const windowStart = Math.max(0, firstFutureIndex < 0 ? source.length - VISIBLE_SENTENCE_COUNT : firstFutureIndex);
    const window = source.slice(windowStart, windowStart + VISIBLE_SENTENCE_COUNT);
    while (window.length < VISIBLE_SENTENCE_COUNT && windowStart - (VISIBLE_SENTENCE_COUNT - window.length) >= 0) {
      const previousEvent = source[windowStart - (VISIBLE_SENTENCE_COUNT - window.length)];
      if (previousEvent) {
        window.unshift(previousEvent);
      } else {
        break;
      }
    }
    return window.map((event) => event.phrase);
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
    videoNow.replaceChildren(...phrases.map((phrase) => renderVideoNowCard(phrase)));
  }

  function renderVideoNowCard(phrase: PhraseExplanation): HTMLElement {
    const item = doc.createElement("article");
    const english = doc.createElement("div");
    const chinese = doc.createElement("div");
    item.className = "ff-video-now-item";
    english.className = "ff-video-now-line ff-video-now-english";
    english.textContent = phrase.phrase;
    chinese.className = "ff-video-now-line ff-video-now-chinese";
    chinese.textContent = phrase.meaningZh;
    item.append(english, chinese);
    return item;
  }

  function renderUsageNotes(notes: UsageNote[] | undefined): HTMLElement | undefined {
    if (!notes || notes.length === 0) {
      return undefined;
    }
    const list = doc.createElement("div");
    list.className = "ff-usage-notes";
    list.replaceChildren(
      ...notes.map((note) => {
        const item = doc.createElement("p");
        const question = doc.createElement("strong");
        question.textContent = `${note.question} `;
        item.append(question, doc.createTextNode(note.explanation));
        return item;
      }),
    );
    return list;
  }

  function renderLearningEventCard(phrase: PhraseExplanation, variant: "current" | "history"): HTMLElement {
    const item = doc.createElement("article");
    const phraseText = doc.createElement("div");
    const meaning = doc.createElement("span");
    const explanation = doc.createElement("p");
    const context = doc.createElement("p");
    const actions = doc.createElement("div");
    const jump = doc.createElement("button");
    const save = doc.createElement("button");
    const cue = findCueForPhrase(phrase);
    item.className = variant === "current" ? "ff-current-phrase-item" : "ff-phrase-item";
    if (variant === "history") {
      item.dataset.phraseId = phrase.id;
      item.dataset.cueId = String(phrase.cueId);
      item.dataset.known = "false";
    }
    phraseText.className = variant === "current" ? "ff-current-phrase-text" : "ff-phrase-text";
    phraseText.textContent = phrase.phrase;
    meaning.className = variant === "current" ? "ff-current-phrase-meaning" : "ff-phrase-meaning";
    meaning.textContent = phrase.meaningZh;
    explanation.className = variant === "current" ? "ff-current-phrase-explanation" : "ff-phrase-explanation";
    explanation.textContent = phrase.explanationEn;
    context.className = "ff-learning-context";
    context.textContent = cue ? cue.english : "";
    actions.className = variant === "current" ? "ff-current-actions" : "ff-phrase-actions";
    jump.type = "button";
    jump.dataset.action = variant === "current" ? "current-jump" : "jump";
    jump.textContent = "Play";
    jump.addEventListener("click", () => {
      if (cue) {
        options.onJumpToMs?.(cue.startMs);
      }
    });
    save.type = "button";
    save.className = "ff-note-button";
    save.dataset.action = "note";
    save.textContent = variant === "current" ? "Add note" : "Note";
    save.addEventListener("click", () => {
      if (cue) {
        void addPersonalNote(cue, phrase);
      }
    });
    if (variant === "history") {
      const copy = doc.createElement("button");
      const known = doc.createElement("button");
      copy.type = "button";
      copy.dataset.action = "copy";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => {
        void writeClipboard(phrase.phrase).then(() => {
          setStatusText("Phrase copied");
        });
      });
      known.type = "button";
      known.dataset.action = "known";
      known.textContent = "Mark known";
      known.addEventListener("click", () => {
        const nextKnown = item.dataset.known !== "true";
        item.dataset.known = String(nextKnown);
        known.textContent = nextKnown ? "Known" : "Mark known";
        known.setAttribute("aria-pressed", String(nextKnown));
      });
      actions.append(jump, copy, save, known);
    } else {
      actions.append(jump, save);
    }
    const usageNotes = renderUsageNotes(phrase.usageNotes);
    item.append(phraseText, meaning, explanation);
    if (usageNotes) {
      item.append(usageNotes);
    }
    item.append(context, actions);
    return item;
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
      ...personalNotes.map((note) => {
        const item = doc.createElement("article");
        const sentence = doc.createElement("div");
        const chinese = doc.createElement("span");
        const phrase = doc.createElement("div");
        const explanation = doc.createElement("p");
        const actions = doc.createElement("div");
        const jump = doc.createElement("button");
        const remove = doc.createElement("button");
        item.className = "ff-note-item";
        item.dataset.noteId = note.id;
        sentence.className = "ff-note-sentence";
        sentence.textContent = note.sentenceEnglish;
        chinese.className = "ff-note-chinese";
        chinese.textContent = note.sentenceChinese;
        phrase.className = "ff-note-phrase";
        phrase.textContent = `${note.phrase} · ${note.meaningZh}`;
        explanation.className = "ff-note-explanation";
        explanation.textContent = note.explanationEn;
        actions.className = "ff-note-actions";
        jump.type = "button";
        jump.dataset.action = "note-jump";
        jump.textContent = "Play";
        jump.addEventListener("click", () => {
          options.onJumpToMs?.(note.startMs);
        });
        remove.type = "button";
        remove.dataset.action = "note-remove";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          void removePersonalNote(note.id);
        });
        actions.append(jump, remove);
        const usageNotes = renderUsageNotes(note.usageNotes);
        item.append(sentence, chinese, phrase, explanation);
        if (usageNotes) {
          item.append(usageNotes);
        }
        item.append(actions);
        return item;
      }),
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

  function startDrag(event: MouseEvent, target: DragTarget): void {
    if (!(event instanceof MouseEvent) || event.button !== 0) {
      return;
    }
    const element = target === "panel"
      ? byId("ff-panel")
      : target === "videoNow"
        ? byId("ff-video-now")
        : byId("ff-overlay");
    const rect = element.getBoundingClientRect();
    dragState = {
      target,
      startMouseX: event.clientX,
      startMouseY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    root.dataset.dragging = "true";
    event.preventDefault();
  }

  byId("ff-panel").querySelector(".ff-header")?.addEventListener("mousedown", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    startDrag(event, "panel");
  });

  root.querySelector(".ff-caption-card")?.addEventListener("mousedown", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    startDrag(event, "subtitle");
  });

  byId("ff-video-now").addEventListener("mousedown", (event) => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    startDrag(event, "videoNow");
  });

  doc.addEventListener("mousemove", (event) => {
    moveDraggedElement(event.clientX, event.clientY);
  });
  doc.addEventListener("mouseup", endDrag);

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
      const activeIndex = findActiveCueIndex(sourceCues, currentMs);
      const overlayCue = activeIndex >= 0 ? sourceCues[activeIndex] : undefined;
      const window = findCueWindow(sourceCues, activeIndex);
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
