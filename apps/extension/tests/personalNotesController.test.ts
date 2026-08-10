import { describe, expect, it, vi } from "vitest";
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
  return createPersonalNotesController({
    store: input,
    render: vi.fn(),
    setStatus: vi.fn(),
    setError: vi.fn(),
  });
}

describe("createPersonalNotesController", () => {
  it("preserves notes saved by another tab when adding a note from stale local state", async () => {
    const saved: PersonalNote[][] = [];
    const controller = createController({
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
    const controller = createController({
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
});
