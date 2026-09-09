import { describe, expect, it, vi } from "vitest";
import type { PersonalNote } from "@fluent-frame/shared";
import type { ContentScriptRuntime } from "../src/learningGenerationClient.js";
import { createNativePersonalNotesStore } from "../src/nativePersonalNotesStore.js";

const note: PersonalNote = {
  id: "dQw4w9WgXcQ:1:p1",
  videoId: "dQw4w9WgXcQ",
  cueId: 1,
  startMs: 0,
  sentenceEnglish: "Nice pass.",
  sentenceChinese: "Good pass.",
  phrase: "nice pass",
  meaningZh: "Good pass",
  explanationEn: "A good pass.",
  savedAt: "2026-07-18T00:00:00.000Z",
};

describe("createNativePersonalNotesStore", () => {
  it("loads and saves personal notes through the content runtime", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
        if ((message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [note] });
          return;
        }
        callback({ id: "notes-2", ok: true, type: "personalNotesSaved" });
      }),
    } satisfies ContentScriptRuntime;
    const store = createNativePersonalNotesStore(runtime);

    await expect(store.load()).resolves.toEqual([note]);
    await expect(store.save([note])).resolves.toBeUndefined();

    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "getPersonalNotes" }, expect.any(Function));
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "savePersonalNotes", notes: [note] }, expect.any(Function));
  });

  it("surfaces native host failures when loading notes", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        callback({ id: "notes-1", ok: false, type: "error", message: "Native notes failed" });
      }),
    } satisfies ContentScriptRuntime;

    await expect(createNativePersonalNotesStore(runtime).load()).rejects.toThrow("Native notes failed");
  });

  it("surfaces Chrome runtime lastError when saving notes", async () => {
    const runtime = {
      lastError: { message: "No native application found" },
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        callback(undefined);
      }),
    } satisfies ContentScriptRuntime;

    await expect(createNativePersonalNotesStore(runtime).save([note])).rejects.toThrow("No native application found");
  });

  it("normalizes synchronous invalidated-context errors", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn(() => {
        throw new Error("Extension context invalidated.");
      }),
    } satisfies ContentScriptRuntime;

    await expect(createNativePersonalNotesStore(runtime).load()).rejects.toThrow("Extension was reloaded. Refresh this YouTube tab.");
  });
});
