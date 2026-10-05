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

function withNotesLock(operation: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks?.request
    ? locks.request<void>("fluent-frame-personal-notes", { mode: "exclusive" }, operation)
    : operation();
}

export function createPersonalNotesController(deps: PersonalNotesControllerDeps): PersonalNotesController {
  const store = deps.store ?? defaultNotesStore();
  let personalNotes: PersonalNote[] = [];
  let pendingMutation: Promise<void> = Promise.resolve();
  let mutationVersion = 0;

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
      const startedAtVersion = mutationVersion;
      void store.load().then(async (notes) => {
        await pendingMutation;
        if (startedAtVersion !== mutationVersion || personalNotes.length > 0) {
          return;
        }
        personalNotes = Array.isArray(notes) ? notes : [];
        render();
      }).catch(async () => {
        await pendingMutation;
        if (startedAtVersion !== mutationVersion) {
          return;
        }
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
        let rollbackNotes = personalNotes;
        const optimistic = upsertNote(personalNotes, nextNote);
        personalNotes = optimistic.notes;
        render();
        deps.setStatus(optimistic.existed ? "Note already saved" : "Adding note...");
        try {
          await withNotesLock(async () => {
            const latest = await store.load();
            mutationVersion += 1;
            rollbackNotes = latest;
            const persisted = upsertNote(latest, nextNote);
            personalNotes = persisted.notes;
            render();
            await store.save(personalNotes);
            deps.setStatus(persisted.existed ? "Note already saved" : "Added to personal notes");
          });
        } catch (error) {
          personalNotes = rollbackNotes;
          render();
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
          await withNotesLock(async () => {
            latestNotes = await store.load();
            mutationVersion += 1;
            personalNotes = latestNotes.filter((note) => note.id !== id);
            render();
            await store.save(personalNotes);
            deps.setStatus("Removed from personal notes");
          });
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
