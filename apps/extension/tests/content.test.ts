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

function enqueueVideoMessages(runtime: { sendMessage: { mock: { calls: unknown[][] } } }): unknown[] {
  return runtime.sendMessage.mock.calls.map((call) => call[0]).filter((message) => {
    return (message as { type?: string }).type === "enqueueVideo";
  });
}

function rememberContextMenuMessages(runtime: { sendMessage: { mock: { calls: unknown[][] } } }): unknown[] {
  return runtime.sendMessage.mock.calls.map((call) => call[0]).filter((message) => {
    return (message as { type?: string }).type === "rememberContextMenuLink";
  });
}

function watchedVideoMessages(runtime: { sendMessage: { mock: { calls: unknown[][] } } }): unknown[] {
  return runtime.sendMessage.mock.calls.map((call) => call[0]).filter((message) => {
    return (message as { type?: string }).type === "markCachedVideoWatched";
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

type MockRuntimePort = {
  name: string;
  postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
  emitMessage(message: unknown): void;
  emitDisconnect(): void;
};

function createRuntimePort(name: string): MockRuntimePort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener(callback) {
        messageListeners.push(callback);
      },
    },
    onDisconnect: {
      addListener(callback) {
        disconnectListeners.push(callback);
      },
    },
    emitMessage(message) {
      messageListeners.forEach((listener) => listener(message));
    },
    emitDisconnect() {
      disconnectListeners.forEach((listener) => listener());
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
    expect(setInterval).toHaveBeenCalledTimes(3);
    expect(processVideoMessages(runtime)).toHaveLength(1);
  });

  it("handles popup generation once through the idempotent bootstrap", () => {
    let listener: ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void | boolean) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        callback({ id: "request-1", ok: true, type: "result", result });
      }),
      onMessage: {
        addListener: vi.fn((nextListener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void | boolean) => {
          listener = nextListener;
        }),
      },
    };
    const win = { setInterval: vi.fn() } as unknown as Window;
    const sendResponse = vi.fn();

    bootstrapContentScript(document, win, runtime as unknown as ContentScriptRuntime);
    bootstrapContentScript(document, win, runtime as unknown as ContentScriptRuntime);
    const handled = listener?.({ type: "popupGenerate" }, {}, sendResponse);

    expect(runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(processVideoMessages(runtime)).toHaveLength(1);
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { type: "processCurrentVideo", videoId: "dQw4w9WgXcQ" },
      expect.any(Function),
    );
  });

  it("toggles the FluentFrame pane from the extension popup message", () => {
    let listener: ((message: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
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

    listener?.({ type: "popupTogglePanel" });
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("true");
    expect(document.getElementById("ff-panel")?.getAttribute("aria-hidden")).toBe("true");

    listener?.({ type: "popupTogglePanel" });
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("false");
    expect(document.getElementById("ff-panel")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("resets FluentFrame pane preferences from the extension popup message", () => {
    let listener: ((message: unknown) => void) | undefined;
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
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
    document.querySelector<HTMLButtonElement>("#ff-hide-panel")?.click();
    document.querySelector<HTMLButtonElement>('[data-layout-option="drawer"]')?.click();
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("true");
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("drawer");

    listener?.({ type: "popupResetUi" });

    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("false");
    expect(document.getElementById("ff-root")?.dataset.layout).toBe("panel");
    expect(document.getElementById("ff-panel")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("adds the current watch video to the generation queue", () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        callback({
          id: "queue-1",
          ok: true,
          type: "queueJob",
          message: "Queued",
          job: {
            id: "dQw4w9WgXcQ:en:test",
            videoId: "dQw4w9WgXcQ",
            captionLanguage: "en",
            workflowVersion: "test",
            status: "queued",
            createdAt: "2026-07-21T00:00:00.000Z",
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
        });
      }),
    } satisfies ContentScriptRuntime;
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-enqueue")?.click();

    expect(enqueueVideoMessages(runtime)).toEqual([
      expect.objectContaining({
        type: "enqueueVideo",
        videoId: "dQw4w9WgXcQ",
      }),
    ]);
    expect(document.getElementById("ff-status")?.textContent).toBe("Queued");
  });

  it("shows a visible queue error when Chrome invalidates the extension context", () => {
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        throw new Error("Extension context invalidated.");
      }),
    } satisfies ContentScriptRuntime;
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);

    expect(() => document.getElementById("ff-enqueue")?.click()).not.toThrow();
    expect(document.body.textContent).toContain("Extension was reloaded. Refresh this YouTube tab.");
  });

  it("does not inject queue buttons into right-hand recommended videos", () => {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="related">
        <ytd-compact-video-renderer>
          <a id="thumbnail" href="https://www.youtube.com/watch?v=o3RPPjzciqo"></a>
          <div id="details">
            <a id="video-title" href="https://www.youtube.com/watch?v=o3RPPjzciqo">Spain vs France</a>
          </div>
        </ytd-compact-video-renderer>
        <ytd-compact-video-renderer>
          <a id="thumbnail" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></a>
          <div id="details">
            <a id="video-title" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Current video</a>
          </div>
        </ytd-compact-video-renderer>
      </div>
    `);
    const runtime = createRuntime();
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    bootstrapContentScript(document, win, runtime);

    expect(document.querySelectorAll(".ff-recommendation-queue-button")).toHaveLength(0);
    expect(enqueueVideoMessages(runtime)).toEqual([]);
  });

  it("remembers the exact right-clicked recommended video link for the context menu", () => {
    document.body.insertAdjacentHTML("beforeend", `
      <div id="related">
        <ytd-compact-video-renderer>
          <a id="thumbnail" href="/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D">
            <span id="thumb-label">10:26</span>
          </a>
          <div id="details">
            <a id="video-title" href="/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D">10-Minute Match | Zidane & Henry</a>
          </div>
        </ytd-compact-video-renderer>
      </div>
    `);
    const runtime = createRuntime();
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("thumb-label")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

    expect(rememberContextMenuMessages(runtime)).toEqual([
      {
        type: "rememberContextMenuLink",
        videoId: "vZ5Bz6ILG5E",
        url: "http://localhost:3000/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D",
        title: "10-Minute Match | Zidane & Henry",
      },
    ]);
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
    expect(document.getElementById("ff-progress")?.textContent).toContain("ETA about 1m");
    currentMs = 46_000;
    callback?.({ id: "request-1", ok: true, type: "result", result });
    expect(document.body.textContent).toContain("Learning subtitles ready in 45s");
    expect(document.getElementById("ff-progress")?.textContent).toContain("Ready in 45s");
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

  it("updates the visible generation progress with elapsed time and long-video batch wording", () => {
    window.localStorage.setItem("fluentFrame.generationHistory.v1", JSON.stringify([
      {
        videoId: "oldvideo123",
        startedAt: "2026-07-20T00:00:00.000Z",
        finishedAt: "2026-07-20T00:02:00.000Z",
        elapsedMs: 120_000,
        status: "success",
      },
    ]));
    let currentMs = 1_000;
    const now = vi.spyOn(Date, "now").mockImplementation(() => currentMs);
    const intervals: Array<() => void> = [];
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
        }
      }),
    } satisfies ContentScriptRuntime;
    const setInterval = vi.spyOn(window, "setInterval").mockImplementation((callback: TimerHandler) => {
      if (typeof callback === "function") {
        intervals.push(callback as () => void);
      }
      return intervals.length as unknown as NodeJS.Timeout;
    });
    const clearInterval = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const mutationObserver = window.MutationObserver;
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: undefined,
    });

    bootstrapContentScript(document, window, runtime);
    document.getElementById("ff-generate")?.click();

    expect(document.getElementById("ff-progress")?.textContent).toContain("ETA about 2m");
    currentMs = 16_000;
    intervals.forEach((callback) => callback());
    expect(document.getElementById("ff-progress")?.textContent).toContain("elapsed 15s");
    expect(document.getElementById("ff-progress")?.textContent).toContain("Generating local batches");
    now.mockRestore();
    setInterval.mockRestore();
    clearInterval.mockRestore();
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: mutationObserver,
    });
  });

  it("shows cache counts, split count, and active part while generating", () => {
    const ports: MockRuntimePort[] = [];
    const runtime = {
      lastError: undefined,
      connect: vi.fn((options?: { name?: string }) => {
        const port = createRuntimePort(options?.name ?? "");
        ports.push(port);
        return port;
      }),
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
        }
      }),
    } satisfies ContentScriptRuntime;
    const setInterval = vi.spyOn(window, "setInterval").mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    const clearInterval = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const mutationObserver = window.MutationObserver;
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: undefined,
    });

    bootstrapContentScript(document, window, runtime);
    document.getElementById("ff-generate")?.click();
    ports[0]?.emitMessage({
      id: "stream-1",
      ok: true,
      type: "progress",
      progress: {
        stage: "cache",
        message: "Cache check",
        totalBatches: 14,
        cache: {
          localResult: false,
          remoteResult: false,
          partialResult: true,
          cachedBatches: 2,
          totalBatches: 14,
        },
      },
    });
    expect(document.getElementById("ff-progress")?.textContent).toContain("parts 14");
    expect(document.getElementById("ff-progress")?.textContent).toContain("cache: local 0, partial 1, remote 0");
    expect(document.getElementById("ff-progress")?.textContent).toContain("cached parts 2/14");

    ports[0]?.emitMessage({
      id: "stream-1",
      ok: true,
      type: "progress",
      progress: {
        stage: "agent",
        message: "Generating part 3 of 14",
        completedBatches: 2,
        totalBatches: 14,
        activeBatch: 3,
      },
    });
    expect(document.getElementById("ff-progress")?.textContent).toContain("Generating part 3/14");
    expect(document.getElementById("ff-progress")?.textContent).toContain("cached parts 2/14");

    setInterval.mockRestore();
    clearInterval.mockRestore();
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: mutationObserver,
    });
  });

  it("keeps repeated generate clicks idempotent while the same video is still streaming", () => {
    const ports: MockRuntimePort[] = [];
    const runtime = {
      lastError: undefined,
      connect: vi.fn((options?: { name?: string }) => {
        const port = createRuntimePort(options?.name ?? "");
        ports.push(port);
        return port;
      }),
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
        }
      }),
    } satisfies ContentScriptRuntime;
    const setInterval = vi.spyOn(window, "setInterval").mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    const clearInterval = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const mutationObserver = window.MutationObserver;
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: undefined,
    });

    bootstrapContentScript(document, window, runtime);
    document.getElementById("ff-generate")?.click();
    document.getElementById("ff-generate")?.click();

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(ports[0]?.postMessage).toHaveBeenCalledOnce();
    expect(document.getElementById("ff-progress")?.textContent).toContain("Already generating");
    setInterval.mockRestore();
    clearInterval.mockRestore();
    Object.defineProperty(window, "MutationObserver", {
      configurable: true,
      value: mutationObserver,
    });
  });

  it("renders streamed partial results and ignores them after navigating to another video", () => {
    const ports: MockRuntimePort[] = [];
    const runtime = {
      lastError: undefined,
      connect: vi.fn((options?: { name?: string }) => {
        const port = createRuntimePort(options?.name ?? "");
        ports.push(port);
        return port;
      }),
      sendMessage: vi.fn((_message: unknown, nextCallback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          nextCallback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
        }
      }),
    } satisfies ContentScriptRuntime;
    let navigationLoop: (() => void) | undefined;
    let syncLoop: (() => void) | undefined;
    const win = {
      ...window,
      setInterval: vi.fn((callback: () => void, ms?: number) => {
        if (ms === 500) {
          navigationLoop = callback;
        }
        if (ms === 50) {
          syncLoop = callback;
        }
        return 1;
      }),
      clearInterval: vi.fn(),
    } as unknown as Window;
    const video = document.createElement("video");
    video.currentTime = 0.5;
    document.body.appendChild(video);

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();
    ports[0]?.emitMessage({ id: "stream-1", ok: true, type: "partialResult", result, completedBatches: 1, totalBatches: 2 });
    syncLoop?.();

    expect(document.body.textContent).toContain("Nice pass.");
    expect(document.getElementById("ff-progress")?.textContent).toContain("Part 1/2 ready");

    window.history.replaceState({}, "", "/watch?v=o3RPPjzciqo");
    navigationLoop?.();
    expect(ports[0]?.disconnect).toHaveBeenCalledOnce();
    ports[0]?.emitMessage({ id: "stream-1", ok: true, type: "partialResult", result: newerResult, completedBatches: 2, totalBatches: 2 });
    syncLoop?.();

    expect(document.body.textContent).not.toContain("New line.");
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

  it("allows a same-video regeneration after the active request has completed", () => {
    const callbacks: Array<(response: unknown) => void> = [];
    const runtime = {
      lastError: undefined,
      sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
        if ((_message as { type?: string }).type === "getPersonalNotes") {
          callback({ id: "notes-1", ok: true, type: "personalNotes", notes: [] });
          return;
        }
        if ((_message as { type?: string }).type === "markCachedVideoWatched") {
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
    callbacks[0]?.({ id: "request-1", ok: true, type: "result", result });
    syncLoop?.();
    expect(document.body.textContent).toContain("Nice pass.");

    document.getElementById("ff-generate")?.click();
    expect(callbacks).toHaveLength(2);
    callbacks[1]?.({ id: "request-2", ok: true, type: "result", result: newerResult });
    syncLoop?.();
    expect(document.body.textContent).toContain("New line.");
  });

  it("marks subtitle results watched when they are shown on the current video", () => {
    const runtime = createRuntime();
    const win = { setInterval: vi.fn() } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    document.getElementById("ff-generate")?.click();

    expect(watchedVideoMessages(runtime)).toEqual([
      {
        type: "markCachedVideoWatched",
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
      },
    ]);
  });

  it("updates cached video title metadata when opening a YouTube video", () => {
    document.title = "Readable video title - YouTube";
    const runtime = createRuntime(undefined);
    let navigationLoop: (() => void) | undefined;
    const win = {
      setInterval: vi.fn((callback: () => void, ms?: number) => {
        if (ms === 500) {
          navigationLoop = callback;
        }
        return 1;
      }),
    } as unknown as Window;

    bootstrapContentScript(document, win, runtime);
    navigationLoop?.();
    navigationLoop?.();

    expect(watchedVideoMessages(runtime)).toEqual([
      {
        type: "markCachedVideoWatched",
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
        title: "Readable video title - YouTube",
      },
    ]);
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

  it("keeps the pane toggle available after navigating away from a watch player", () => {
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
    const player = document.createElement("div");
    const video = document.createElement("video");
    const controls = document.createElement("div");
    player.className = "html5-video-player playing-mode";
    controls.className = "ytp-right-controls";
    player.append(video, controls);
    document.body.appendChild(player);

    bootstrapContentScript(document, win, runtime);
    syncLoop?.();
    expect(document.querySelector<HTMLButtonElement>("#ff-video-badge")?.parentElement).toBe(controls);

    player.remove();
    syncLoop?.();

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement?.id).toBe("ff-root");
    expect(badge?.classList.contains("ff-in-player-controls")).toBe(false);

    badge?.click();
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("true");
    badge?.click();
    expect(document.getElementById("ff-root")?.dataset.panelCollapsed).toBe("false");
  });

  it("restores the pane toggle when only a zero-size list preview video remains", () => {
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
    const player = document.createElement("div");
    const watchVideo = document.createElement("video");
    const controls = document.createElement("div");
    const previewVideo = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    controls.className = "ytp-right-controls";
    player.append(watchVideo, controls);
    document.body.appendChild(player);

    bootstrapContentScript(document, win, runtime);
    syncLoop?.();
    expect(document.querySelector<HTMLButtonElement>("#ff-video-badge")?.parentElement).toBe(controls);

    previewVideo.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    player.remove();
    document.body.appendChild(previewVideo);
    syncLoop?.();

    const badge = document.querySelector<HTMLButtonElement>("#ff-video-badge");
    expect(badge?.parentElement?.id).toBe("ff-root");
    expect(badge?.classList.contains("ff-in-player-controls")).toBe(false);
    expect(badge?.style.right).toBe("");
    expect(badge?.style.bottom).toBe("");
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
