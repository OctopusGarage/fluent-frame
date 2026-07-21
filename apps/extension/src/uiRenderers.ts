import type { PersonalNote, PhraseExplanation, SubtitleCue, UsageNote } from "@fluent-frame/shared";

export function renderUsageNotes(doc: Document, notes: UsageNote[] | undefined): HTMLElement | undefined {
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

export function renderVideoNowCard(doc: Document, phrase: PhraseExplanation): HTMLElement {
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

export function renderLearningEventCard(
  doc: Document,
  input: {
    phrase: PhraseExplanation;
    variant: "current" | "history";
    cue: SubtitleCue | undefined;
    onJump(startMs: number): void;
    onSave(cue: SubtitleCue, phrase: PhraseExplanation): void;
    onCopy(text: string): void;
    onKnownChange(message: string): void;
  },
): HTMLElement {
  const { phrase, variant, cue } = input;
  const item = doc.createElement("article");
  const phraseText = doc.createElement("div");
  const meaning = doc.createElement("span");
  const explanation = doc.createElement("p");
  const context = doc.createElement("p");
  const actions = doc.createElement("div");
  const jump = doc.createElement("button");
  const save = doc.createElement("button");
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
      input.onJump(cue.startMs);
    }
  });
  save.type = "button";
  save.className = "ff-note-button";
  save.dataset.action = "note";
  save.textContent = variant === "current" ? "Add note" : "Note";
  save.addEventListener("click", () => {
    if (cue) {
      input.onSave(cue, phrase);
    }
  });
  if (variant === "history") {
    const copy = doc.createElement("button");
    const known = doc.createElement("button");
    copy.type = "button";
    copy.dataset.action = "copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      input.onCopy(phrase.phrase);
    });
    known.type = "button";
    known.dataset.action = "known";
    known.textContent = "Mark known";
    known.addEventListener("click", () => {
      const nextKnown = item.dataset.known !== "true";
      item.dataset.known = String(nextKnown);
      known.textContent = nextKnown ? "Known" : "Mark known";
      known.setAttribute("aria-pressed", String(nextKnown));
      input.onKnownChange(nextKnown ? "Known" : "Mark known");
    });
    actions.append(jump, copy, save, known);
  } else {
    actions.append(jump, save);
  }
  const usageNotes = renderUsageNotes(doc, phrase.usageNotes);
  item.append(phraseText, meaning, explanation);
  if (usageNotes) {
    item.append(usageNotes);
  }
  item.append(context, actions);
  return item;
}

export function renderPersonalNoteCard(
  doc: Document,
  input: {
    note: PersonalNote;
    onJump(startMs: number): void;
    onRemove(id: string): void;
  },
): HTMLElement {
  const { note } = input;
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
    input.onJump(note.startMs);
  });
  remove.type = "button";
  remove.dataset.action = "note-remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    input.onRemove(note.id);
  });
  actions.append(jump, remove);
  const usageNotes = renderUsageNotes(doc, note.usageNotes);
  item.append(sentence, chinese, phrase, explanation);
  if (usageNotes) {
    item.append(usageNotes);
  }
  item.append(actions);
  return item;
}
