import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { bootstrapContentScript, type ContentScriptRuntime } from "../src/content.js";

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: "test",
  generatedAt: "2026-07-18T00:00:00.000Z",
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
};

const newerResult: LearningSubtitleResult = {
  ...result,
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "New line.", chinese: "新字幕。", phraseIds: ["p2"] }],
  phrases: [{ id: "p2", cueId: 1, phrase: "new line", meaningZh: "新字幕", explanationEn: "The newer result.", difficulty: "basic" }],
};

const twoCueResult: LearningSubtitleResult = {
  ...result,
  subtitles: [
    { id: 1, startMs: 0, endMs: 1000, english: "Old cue.", chinese: "旧字幕。", phraseIds: ["p1"] },
    { id: 2, startMs: 10_000, endMs: 11_000, english: "Main cue.", chinese: "主字幕。", phraseIds: ["p2"] },
  ],
  phrases: [
    { id: "p1", cueId: 1, phrase: "old cue", meaningZh: "旧字幕", explanationEn: "The first cue.", difficulty: "basic" },
    { id: "p2", cueId: 2, phrase: "main cue", meaningZh: "主字幕", explanationEn: "The active main player cue.", difficulty: "basic" },
  ],
};

function createRuntime(response: LearningSubtitleResult | undefined = result, lastError?: { message?: string }) {
  return {
    lastError,
    sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      if ((_message as { type?: string }).type === "getPersonalNotes") {
        callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
        return;
      }
      if ((_message as { type?: string }).type === "savePersonalNotes") {
        callback({ id: "notes-2", ok: true, type: "personalNotesSaved" });
        return;
      }
      callback(response ? { id: "request-1", ok: true, type: "result", result: response } : undefined);
    }),
  } satisfies ContentScriptRuntime;
}

function processVideoMessages(runtime: { sendMessage: { mock: { calls: unknown[][] } } }): unknown[] {
  return runtime.sendMessage.mock.calls.map((call) => call[0]).filter((message) => {
    return (message as { type?: string }).type === "processCurrentVideo";
  });
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("bootstrapContentScript", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete (window as Window & { __fluentFrameBootstrapped?: boolean }).__fluentFrameBootstrapped;
    window.history.replaceState({}, "", "/watch?v=dQw4w9WgXcQ");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    });
    vi.unstubAllGlobals();
  });

  it("does not bind duplicate click handlers or intervals when reinjected", () => {
    const runtime = createRuntime();
    const setInterval = vi.fn();
    const win = { setInterval } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    bootstrapContentScript(document, win, runtime);

    document.getElementById("ff-generate")?.click();

    expect(document.querySelectorAll("#ff-root")).toHaveLength(1);
    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(processVideoMessages(runtime)).toHaveLength(1);
  });

  it("handles popup generation once through the idempotent bootstrap", () => {
    let listener: ((message: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        callback({ id: "request-1", ok: true, type: "result", result });
      }),
      onMessage: {
        addListener: vi.fn((nextListener: (message: unknown) => void) => {
          listener = nextListener;
        }),
      },
    };
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime as unknown as ContentScriptRuntime);
    bootstrapContentScript(document, win, runtime as unknown as ContentScriptRuntime);
    listener?.({ type: "popupGenerate" });

    expect(runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(processVideoMessages(runtime)).toHaveLength(1);
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { type: "processCurrentVideo", videoId: "dQw4w9WgXcQ" },
      expect.any(Function),
    );
  });

  it("clears stale subtitles when starting a new request", () => {
    const runtime = createRuntime();
    let syncLoop: (() => void) | undefined;
    const win = {
      setInterval: vi.fn((callback: () => void, ms?: number) => {
        if (ms === 50) {
          syncLoop = callback;
        }
        return 1;
      }),
    } as unknown as Window;
    const video = document.createElement("video");
    video.currentTime = 0.5;
    document.body.appendChild(video);

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    syncLoop?.();
    expect(document.body.textContent).toContain("Nice pass.");

    runtime.sendMessage.mockImplementationOnce((_message: unknown, callback: (response: unknown) => void) => {
      expect(document.body.textContent).not.toContain("Nice pass.");
      expect(document.body.textContent).toContain("Generating learning subtitles...");
      callback(undefined);
    });
    document.getElementById("ff-generate")?.click();
  });

  it("shows an estimated generation time from previous successful runs and records the new duration", () => {
    window.localStorage.setItem("fluentFrame.generationHistory.v1", JSON.stringify([
      {
        videoId: "oldvideo123",
        startedAt: "2026-07-20T00:00:00.000Z",
        finishedAt: "2026-07-20T00:01:00.000Z",
        elapsedMs: 60_000,
        status: "success",
      },
    ]));
    let currentMs = 1_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentMs);
    let callback: ((response: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        callback = nextCallback;
      }),
    } satisfies ContentScriptRuntime;
    const setInterval = vi.spyOn(window, "setInterval").mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    const mutationObserver = window.MutationObserver;
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: undefined,
    });

    bootstrapContentScript(document, window, runtime);
    document.getElementById("ff-generate")?.click();

    expect(document.body.textContent).toContain("ETA about 1m");
    currentMs = 46_000;
    callback?.({ id: "request-1", ok: true, type: "result", result });
    expect(document.body.textContent).toContain("Learning subtitles ready in 45s");
    const history = JSON.parse(window.localStorage.getItem("fluentFrame.generationHistory.v1") ?? "[]") as Array<{ elapsedMs: number; status: string }>;
    expect(history[0]).toMatchObject({ elapsedMs: 45_000, status: "success" });
    now.mockRestore();
    setInterval.mockRestore();
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: mutationObserver,
    });
  });

  it("shows first-run ETA feedback before any generation history exists", () => {
    let callback: ((response: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        callback = nextCallback;
      }),
    } satisfies ContentScriptRuntime;
    const setInterval = vi.spyOn(window, "setInterval").mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    const mutationObserver = window.MutationObserver;
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: undefined,
    });

    bootstrapContentScript(document, window, runtime);
    document.getElementById("ff-generate")?.click();

    expect(document.body.textContent).toContain("ETA after first run");
    callback?.({ id: "request-1", ok: true, type: "result", result });
    expect(document.body.textContent).toContain("Learning subtitles ready in");
    setInterval.mockRestore();
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: mutationObserver,
    });
  });

  it("renders chrome runtime lastError as a visible UI error", () => {
    const runtime = createRuntime(undefined, { message: "No native application found" });
    const win = { setInterval: vi.fn() } as unknown as Window;
    bootstrapContentScript(document, win, runtime);

    document.getElementById("ff-generate")?.click();

    expect(document.body.textContent).toContain("No native application found");
  });

  it("shows a reload error instead of throwing when Chrome invalidates the extension context", () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn(() => {
        throw new Error("Extension context invalidated.");
      }),
    } satisfies ContentScriptRuntime;
    const win = { setInterval: vi.fn() } as unknown as Window;
    bootstrapContentScript(document, win, runtime);

    expect(() => document.getElementById("ff-generate")?.click()).not.toThrow();
    expect(document.body.textContent).toContain("Extension was reloaded. Refresh this YouTube tab.");
  });

  it("ignores older overlapping responses when they arrive after the latest request", () => {
    const callbacks: Array<(response: unknown) => void> = [];
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        callbacks.push(callback);
      }),
    } satisfies ContentScriptRuntime;
    let syncLoop: (() => void) | undefined;
    const win = {
      setInterval: vi.fn((callback: () => void, ms?: number) => {
        if (ms === 50) {
          syncLoop = callback;
        }
        return 1;
      }),
    } as unknown as Window;
    const video = document.createElement("video");
    video.currentTime = 0.5;
    document.body.appendChild(video);

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    document.getElementById("ff-generate")?.click();

    callbacks[1]?.({ id: "request-2", ok: true, type: "result", result: newerResult });
    syncLoop?.();
    expect(document.body.textContent).toContain("New line.");

    callbacks[0]?.({ id: "request-1", ok: true, type: "result", result });
    syncLoop?.();

    expect(document.body.textContent).toContain("New line.");
    expect(document.body.textContent).not.toContain("Nice pass.");
  });

  it("ignores a response when the page has moved to another video", () => {
    let callback: ((response: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        callback = nextCallback;
      }),
    } satisfies ContentScriptRuntime;
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    window.history.replaceState({}, "", "/watch?v=aaaaaaaaaaa");
    callback?.({ id: "request-1", ok: true, type: "result", result });

    expect(document.body.textContent).not.toContain("Learning subtitles ready");
    expect(document.body.textContent).not.toContain("nice pass");
  });

  it("resets to Ready and ignores stale responses after YouTube SPA navigation", () => {
    let callback: ((response: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        callback = nextCallback;
      }),
    } satisfies ContentScriptRuntime;
    const intervals: Array<{ callback: () => void; ms: number }> = [];
    const win = {
      setInterval: vi.fn((nextCallback: () => void, ms?: number) => {
        intervals.push({ callback: nextCallback, ms: ms ?? 0 });
        return intervals.length;
      }),
    } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    expect(document.body.textContent).toContain("Generating learning subtitles...");

    window.history.replaceState({}, "", "/watch?v=aaaaaaaaaaa");
    intervals.find((interval) => interval.ms === 500)?.callback();
    callback?.({ id: "request-1", ok: true, type: "result", result });

    expect(document.body.textContent).toContain("Ready");
    expect(document.body.textContent).not.toContain("Learning subtitles ready");
    expect(document.body.textContent).not.toContain("nice pass");
  });

  it("keeps pending responses valid when YouTube changes URL details for the same video", () => {
    let callback: ((response: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        callback = nextCallback;
      }),
    } satisfies ContentScriptRuntime;
    const intervals: Array<{ callback: () => void; ms: number }> = [];
    const win = {
      setInterval: vi.fn((nextCallback: () => void, ms?: number) => {
        intervals.push({ callback: nextCallback, ms: ms ?? 0 });
        return intervals.length;
      }),
    } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    window.history.replaceState({}, "", "/watch?v=dQw4w9WgXcQ&t=42s&feature=shared");
    intervals.find((interval) => interval.ms === 500)?.callback();
    callback?.({ id: "request-1", ok: true, type: "result", result });

    expect(document.body.textContent).toContain("Learning subtitles ready");
    expect(document.body.textContent).toContain("nice pass");
  });

  it("jumps phrase controls through the content video path", () => {
    const runtime = createRuntime();
    const win = { setInterval: vi.fn() } as unknown as Window;
    const video = document.createElement("video");
    video.currentTime = 9;
    document.body.appendChild(video);
    bootstrapContentScript(document, win, runtime);

    document.getElementById("ff-generate")?.click();
    document.querySelector<HTMLButtonElement>('[data-action="jump"]')?.click();

    expect(video.currentTime).toBe(0);
  });

  it("persists personal notes through native-backed runtime messages", async () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
        if ((message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        if ((message as { type?: string }).type === "savePersonalNotes") {
          callback({ id: "notes2", ok: true, type: "personalNotesSaved" });
          return;
        }
        callback({ id: "request-1", ok: true, type: "result", result });
      }),
    } satisfies ContentScriptRuntime;
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    document.querySelector<HTMLButtonElement>('[data-action="note"]')?.click();

    await vi.waitFor(() => {
      expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "getPersonalNotes" }, expect.any(Function));
      expect(runtime.sendMessage).toHaveBeenCalledWith(
        {
          type: "savePersonalNotes",
          notes: [
            expect.objectContaining({
              sentenceEnglish: "Nice pass.",
              phrase: "nice pass",
              explanationEn: "A good pass.",
            }),
          ],
        },
        expect.any(Function),
      );
    });
  });

  it("reattaches player UI when YouTube rebuilds the player controls", () => {
    const runtime = createRuntime();
    let observedTarget: Node | undefined;
    let observerCallback: MutationCallback | undefined;
    class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }
      observe(target: Node): void {
        observedTarget = target;
      }
      disconnect(): void {
        observedTarget = undefined;
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    const win = {
      setInterval: vi.fn(),
      MutationObserver: FakeMutationObserver,
    } as unknown as Window;
    const player = document.createElement("div");
    const video = document.createElement("video");
    const controls = document.createElement("div");
    const ccButton = document.createElement("button");
    player.className = "html5-video-player playing-mode";
    controls.className = "ytp-right-controls";
    ccButton.className = "ytp-subtitles-button";
    controls.append(ccButton);
    player.append(video, controls);
    document.body.appendChild(player);

    bootstrapContentScript(document, win, runtime);
    observerCallback?.([], {} as MutationObserver);

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(observedTarget).toBe(document.body);
    expect(badge?.parentElement).toBe(controls);
    expect(controls.children[0]).toBe(badge);
    expect(controls.children[1]).toBe(ccButton);
    expect(document.getElementById("ff-overlay")?.parentElement).toBe(player);
  });

  it("syncs subtitles from the main YouTube player instead of an earlier preview video", () => {
    const runtime = createRuntime(twoCueResult);
    let syncLoop: (() => void) | undefined;
    const win = {
      setInterval: vi.fn((callback: () => void, ms?: number) => {
        if (ms === 50) {
          syncLoop = callback;
        }
        return 1;
      }),
    } as unknown as Window;
    const previewVideo = document.createElement("video");
    const moviePlayer = document.createElement("div");
    const mainVideo = document.createElement("video");
    previewVideo.currentTime = 0.5;
    mainVideo.currentTime = 10.5;
    moviePlayer.id = "movie_player";
    moviePlayer.className = "html5-video-player playing-mode";
    moviePlayer.append(mainVideo);
    document.body.append(previewVideo, moviePlayer);

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    syncLoop?.();

    expect(document.getElementById("ff-english")?.textContent).toBe("Main cue.");
    expect(document.getElementById("ff-current-phrase")?.textContent).toContain("main cue");
    expect(document.getElementById("ff-current-phrase")?.textContent).not.toContain("old cue");
  });
});
