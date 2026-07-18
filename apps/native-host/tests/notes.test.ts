import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersonalNote } from "@fluent-frame/shared";
import { readPersonalNotes, writePersonalNotes } from "../src/notes.js";

let dir = "";
let notesPath = "";

const note: PersonalNote = {
  id: "dQw4w9WgXcQ:1:p1",
  videoId: "dQw4w9WgXcQ",
  cueId: 1,
  startMs: 1200,
  sentenceEnglish: "Nice pass.",
  sentenceChinese: "传得漂亮。",
  phrase: "nice pass",
  meaningZh: "传得漂亮",
  explanationEn: "A good pass.",
  savedAt: "2026-07-19T00:00:00.000Z",
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-notes-"));
  notesPath = join(dir, ".fluent-frame", "notes.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("personal notes", () => {
  it("returns an empty list when notes.json does not exist", async () => {
    await expect(readPersonalNotes(notesPath)).resolves.toEqual([]);
  });

  it("writes notes to notes.json under the configured directory", async () => {
    await writePersonalNotes(notesPath, [note]);

    await expect(readPersonalNotes(notesPath)).resolves.toEqual([note]);
    await expect(readFile(notesPath, "utf8")).resolves.toContain('"version": 1');
  });

  it("rejects malformed notes files", async () => {
    await mkdir(join(notesPath, ".."), { recursive: true });
    await writeFile(notesPath, JSON.stringify({ version: 1, notes: [{ id: "../bad" }] }), "utf8");

    await expect(readPersonalNotes(notesPath)).rejects.toThrow("Invalid personal notes file");
  });
});
