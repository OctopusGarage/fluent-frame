import type { PersonalNote, PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";

export type PersonalNotesStore = {
  load(): Promise<PersonalNote[]>;
  save(notes: PersonalNote[]): Promise<void>;
};

export type PersonalNotesController = {
  notes(): PersonalNote[];
  load(): void;
  add(input: { videoId: string; cue: SubtitleCue; phrase?: PhraseExplanation }): Promise<void>;
  remove(id: string): Promise<void>;
};

export type PersonalNotesControllerDeps = {
  store?: PersonalNotesStore;
  render(notes: PersonalNote[]): void;
  setStatus(message: string): void;
  setError(message: string): void;
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function noteId(videoId: string, cue: SubtitleCue, phrase: PhraseExplanation | undefined): string {
  const rawPhraseId = phrase?.id ?? "subtitle";
  const safePhraseId = rawPhraseId.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 120) || "phrase";
  return `${videoId}:${cue.id}:${safePhraseId}`;
}

function defaultNotesStore(): PersonalNotesStore {
  return {
    load: () => Promise.resolve([]),
    save: () => Promise.resolve(),
  };
}

function upsertNote(notes: PersonalNote[], nextNote: PersonalNote): { notes: PersonalNote[]; existed: boolean } {
  const existingIndex = notes.findIndex((note) => note.id === nextNote.id);
  if (existingIndex >= 0) {
    return {
      existed: true,
      notes: notes.map((note, index) => (index === existingIndex ? { ...nextNote, savedAt: note.savedAt } : note)),
    };
  }
  return { existed: false, notes: [nextNote, ...notes] };
}

export function createPersonalNotesController(deps: PersonalNotesControllerDeps): PersonalNotesController {
  const store = deps.store ?? defaultNotesStore();
  let personalNotes: PersonalNote[] = [];
  let pendingMutation: Promise<void> = Promise.resolve();

  function serializeMutation(operation: () => Promise<void>): Promise<void> {
    const current = pendingMutation.then(operation);
    pendingMutation = current.catch(() => {});
    return current;
  }

  function render(): void {
    deps.render(personalNotes);
  }

  return {
    notes() {
      return personalNotes;
    },
    load() {
      void store.load().then((notes) => {
        if (personalNotes.length > 0) {
          return;
        }
        personalNotes = Array.isArray(notes) ? notes : [];
        render();
      }).catch(() => {
        if (personalNotes.length === 0) {
          personalNotes = [];
        }
        render();
      });
    },
    add({ videoId, cue, phrase }) {
      return serializeMutation(async () => {
        const nextNote: PersonalNote = {
          id: noteId(videoId, cue, phrase),
          videoId,
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
        const optimistic = upsertNote(personalNotes, nextNote);
        personalNotes = optimistic.notes;
        render();
        deps.setStatus(optimistic.existed ? "Note already saved" : "Adding note...");
        try {
          const latest = await store.load();
          const persisted = upsertNote(latest, nextNote);
          personalNotes = persisted.notes;
          render();
          await store.save(personalNotes);
          deps.setStatus(persisted.existed ? "Note already saved" : "Added to personal notes");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Local helper failed";
          deps.setError(`Note not saved: ${message}`);
        }
      });
    },
    remove(id) {
      return serializeMutation(async () => {
        let latestNotes = personalNotes;
        personalNotes = personalNotes.filter((note) => note.id !== id);
        render();
        try {
          latestNotes = await store.load();
          personalNotes = latestNotes.filter((note) => note.id !== id);
          render();
          await store.save(personalNotes);
          deps.setStatus("Removed from personal notes");
        } catch (error) {
          personalNotes = latestNotes;
          render();
          const message = error instanceof Error ? error.message : "Local helper failed";
          deps.setError(`Note not removed: ${message}`);
        }
      });
    },
  };
}
