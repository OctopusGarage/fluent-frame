import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalNote, PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";
import { createPersonalNotesController } from "../src/personalNotesController.js";

const cue: SubtitleCue = {
  id: 1,
  startMs: 1200,
  endMs: 2200,
  english: "Nice pass.",
  chinese: "传得漂亮。",
  phraseIds: ["p1"],
};

const phrase: PhraseExplanation = {
  id: "p1",
  cueId: 1,
  phrase: "nice pass",
  meaningZh: "传得漂亮",
  explanationEn: "A good pass.",
  difficulty: "basic",
};

const existingNote: PersonalNote = {
  id: "o3RPPjzciqo:2:p2",
  videoId: "o3RPPjzciqo",
  cueId: 2,
  startMs: 5000,
  sentenceEnglish: "Great finish.",
  sentenceChinese: "精彩射门。",
  phrase: "great finish",
  meaningZh: "精彩射门",
  explanationEn: "A strong shot that scores.",
  savedAt: "2026-07-21T00:00:00.000Z",
};

const noteToRemove: PersonalNote = {
  id: "dQw4w9WgXcQ:1:p1",
  videoId: "dQw4w9WgXcQ",
  cueId: 1,
  startMs: 1200,
  sentenceEnglish: "Nice pass.",
  sentenceChinese: "传得漂亮。",
  phrase: "nice pass",
  meaningZh: "传得漂亮",
  explanationEn: "A good pass.",
  savedAt: "2026-07-21T00:00:01.000Z",
};

function createController(input: {
  load: () => Promise<PersonalNote[]>;
  save: (notes: PersonalNote[]) => Promise<void>;
}) {
  const render = vi.fn();
  const setStatus = vi.fn();
  const setError = vi.fn();
  const controller = createPersonalNotesController({
    store: input,
    render,
    setStatus,
    setError,
  });
  return { controller, render, setStatus, setError };
}

describe("createPersonalNotesController", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves both notes when separate tabs add during one pending save", async () => {
    let persisted: PersonalNote[] = [];
    let releaseFirstSave: (() => void) | undefined;
    let firstSaveStarted: (() => void) | undefined;
    let markSecondRequestQueued: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const secondRequestQueued = new Promise<void>((resolve) => { markSecondRequestQueued = resolve; });
    let saves = 0;
    let requests = 0;
    let lockTail = Promise.resolve();
    const request = vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => {
      const current = lockTail.then(callback);
      lockTail = current.catch(() => {});
      if (++requests === 2) markSecondRequestQueued?.();
      return current;
    });
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request } }));
    const store = {
      load: async () => [...persisted],
      save: async (notes: PersonalNote[]) => {
        if (++saves === 1) {
          firstSaveStarted?.();
          await release;
        }
        persisted = [...notes];
      },
    };
    const first = createController(store).controller;
    const second = createController(store).controller;

    const firstAdd = first.add({ videoId: "dQw4w9WgXcQ", cue, phrase });
    await started;
    const secondAdd = second.add({ videoId: "dQw4w9WgXcQ", cue: { ...cue, id: 2 } });
    await secondRequestQueued;
    releaseFirstSave?.();
    await Promise.all([firstAdd, secondAdd]);

    expect(persisted.map((note) => note.id)).toEqual([
      "dQw4w9WgXcQ:2:subtitle",
      "dQw4w9WgXcQ:1:p1",
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases the cross-tab lock when a save fails", async () => {
    let lockTail = Promise.resolve();
    const request = vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => {
      const current = lockTail.then(callback);
      lockTail = current.catch(() => {});
      return current;
    });
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request } }));
    let persisted: PersonalNote[] = [];
    let saves = 0;
    const store = {
      load: async () => [...persisted],
      save: async (notes: PersonalNote[]) => {
        if (++saves === 1) throw new Error("Native save failed");
        persisted = [...notes];
      },
    };
    const first = createController(store);
    const second = createController(store);

    await first.controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase });
    await second.controller.add({ videoId: "dQw4w9WgXcQ", cue: { ...cue, id: 2 } });

    expect(first.setError).toHaveBeenCalledWith("Note not saved: Native save failed");
    expect(persisted.map((note) => note.id)).toEqual(["dQw4w9WgXcQ:2:subtitle"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports a cancelled lock request without touching the store", async () => {
    const request = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { locks: { request } }));
    const load = vi.fn(async () => []);
    const save = vi.fn(async () => {});
    const { controller, setError } = createController({ load, save });

    await controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase });

    expect(setError).toHaveBeenCalledWith("Note not saved: Local helper failed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves both notes when two saves overlap", async () => {
    let persisted: PersonalNote[] = [];
    const { controller } = createController({
      load: async () => [...persisted],
      save: async (notes) => { persisted = [...notes]; },
    });
    const secondCue = { ...cue, id: 2, startMs: 3000, endMs: 4000 };

    await Promise.all([
      controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase }),
      controller.add({ videoId: "dQw4w9WgXcQ", cue: secondCue }),
    ]);

    expect(persisted.map((note) => note.id)).toEqual([
      "dQw4w9WgXcQ:2:subtitle",
      "dQw4w9WgXcQ:1:p1",
    ]);
  });

  it("preserves notes saved by another tab when adding a note from stale local state", async () => {
    const saved: PersonalNote[][] = [];
    const { controller } = createController({
      load: vi.fn().mockResolvedValue([existingNote]),
      save: vi.fn(async (notes) => {
        saved.push(notes);
      }),
    });

    await controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.map((note) => note.id)).toEqual(["dQw4w9WgXcQ:1:p1", existingNote.id]);
  });

  it("preserves notes saved by another tab when removing a note from stale local state", async () => {
    let loadCount = 0;
    const saved: PersonalNote[][] = [];
    const { controller } = createController({
      load: vi.fn(async () => {
        loadCount += 1;
        return loadCount === 1 ? [noteToRemove] : [noteToRemove, existingNote];
      }),
      save: vi.fn(async (notes) => {
        saved.push(notes);
      }),
    });
    controller.load();
    await vi.waitFor(() => {
      expect(controller.notes()).toHaveLength(1);
    });

    await controller.remove(noteToRemove.id);

    expect(saved).toEqual([[existingNote]]);
  });

  it("does not restore a removed note when the initial load finishes late", async () => {
    let persisted = [noteToRemove];
    let resolveInitialLoad: ((notes: PersonalNote[]) => void) | undefined;
    const initialLoad = new Promise<PersonalNote[]>((resolve) => { resolveInitialLoad = resolve; });
    let loadCount = 0;
    const { controller } = createController({
      load: () => ++loadCount === 1 ? initialLoad : Promise.resolve([...persisted]),
      save: async (notes) => { persisted = [...notes]; },
    });

    controller.load();
    await controller.add({ videoId: noteToRemove.videoId, cue, phrase });
    await controller.remove(noteToRemove.id);
    expect(persisted).toEqual([]);

    resolveInitialLoad?.([noteToRemove]);
    await initialLoad;
    await Promise.resolve();
    expect(controller.notes()).toEqual([]);
  });

  it("does not overwrite persisted notes when the refresh before adding fails", async () => {
    let persisted = [existingNote];
    const save = vi.fn(async (notes: PersonalNote[]) => { persisted = notes; });
    const { controller, setError, setStatus } = createController({
      load: async () => { throw new Error("Native read failed"); },
      save,
    });

    await controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase });

    expect(save).not.toHaveBeenCalled();
    expect(persisted).toEqual([existingNote]);
    expect(setError).toHaveBeenCalledWith("Note not saved: Native read failed");
    expect(setStatus).not.toHaveBeenCalledWith("Added to personal notes");
    expect(controller.notes()).toEqual([]);
  });

  it("removes an optimistic note when saving it fails", async () => {
    const { controller, setError } = createController({
      load: async () => [existingNote],
      save: async () => { throw new Error("Native save failed"); },
    });

    await controller.add({ videoId: "dQw4w9WgXcQ", cue, phrase });

    expect(controller.notes()).toEqual([existingNote]);
    expect(setError).toHaveBeenCalledWith("Note not saved: Native save failed");
  });

  it("does not overwrite persisted notes when the refresh before removing fails", async () => {
    let persisted = [noteToRemove];
    let loadCount = 0;
    const save = vi.fn(async (notes: PersonalNote[]) => { persisted = notes; });
    const { controller, setError, setStatus } = createController({
      load: async () => {
        if (++loadCount === 1) return persisted;
        throw new Error("Native read failed");
      },
      save,
    });
    controller.load();
    await vi.waitFor(() => expect(controller.notes()).toEqual([noteToRemove]));
    persisted = [noteToRemove, existingNote];

    await controller.remove(noteToRemove.id);

    expect(save).not.toHaveBeenCalled();
    expect(persisted).toEqual([noteToRemove, existingNote]);
    expect(controller.notes()).toEqual([noteToRemove]);
    expect(setError).toHaveBeenCalledWith("Note not removed: Native read failed");
    expect(setStatus).not.toHaveBeenCalledWith("Removed from personal notes");
  });

  it("surfaces save failures when removing a note", async () => {
    const { controller, setError } = createController({
      load: vi.fn().mockResolvedValue([noteToRemove]),
      save: vi.fn(async () => {
        throw new Error("Native save failed");
      }),
    });
    controller.load();
    await vi.waitFor(() => {
      expect(controller.notes()).toHaveLength(1);
    });

    await controller.remove(noteToRemove.id);

    expect(setError).toHaveBeenCalledWith("Note not removed: Native save failed");
  });
});
