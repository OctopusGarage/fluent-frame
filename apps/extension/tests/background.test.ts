import { NATIVE_HOST_NAME, WORKFLOW_VERSION } from "@fluent-frame/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerBackgroundListener,
  type ExtensionRuntime,
} from "../src/background.js";
import { registerQueueContextMenus } from "../src/backgroundQueueContextMenus.js";
import { createRequestId } from "../src/requestId.js";
import { normalizeExtensionError, normalizeNativeResponse } from "../src/nativeHostClient.js";

type RuntimeMessageCallback = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean;
type NativeResponseFactory = (request: unknown) => unknown;
type PortListener<T> = { addListener(callback: T): void };
type ContextMenuClick = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void;
type MockPort = {
  name: string;
  onMessage: PortListener<(message: unknown) => void>;
  onDisconnect: PortListener<() => void>;
  postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>>;
  disconnect: ReturnType<typeof vi.fn<() => void>>;
  emitMessage(message: unknown): void;
  emitDisconnect(): void;
};

function createContextMenusMock() {
  let clickListener: ContextMenuClick | undefined;
  return {
    contextMenus: {
      removeAll: vi.fn((callback?: () => void) => {
        callback?.();
      }),
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn((callback: ContextMenuClick) => {
          clickListener = callback;
        }),
      },
    },
    click(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) {
      if (!clickListener) {
        throw new Error("Expected context menu click listener");
      }
      clickListener(info, tab);
    },
  };
}

function createRuntimeMock(response: unknown | NativeResponseFactory, lastError?: { message?: string }) {
  let listener: RuntimeMessageCallback | undefined;
  const runtime: ExtensionRuntime & {
    sendNativeMessage: ReturnType<
      typeof vi.fn<(_hostName: string, _request: unknown, callback: (response: unknown) => void) => void>
    >;
    onMessage: {
      addListener: ReturnType<typeof vi.fn<(callback: RuntimeMessageCallback) => void>>;
    };
  } = {
    lastError,
    onMessage: {
      addListener: vi.fn((callback: RuntimeMessageCallback) => {
        listener = callback;
      }),
    },
    sendNativeMessage: vi.fn((_hostName: string, request: unknown, callback: (response: unknown) => void) => {
      callback(typeof response === "function" ? response(request) : response);
    }),
  };

  return {
    runtime,
    getListener() {
      if (!listener) {
        throw new Error("Listener was not registered");
      }
      return listener;
    },
  };
}

function createMockPort(name: string): MockPort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  return {
    name,
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
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    emitMessage(message) {
      messageListeners.forEach((listener) => listener(message));
    },
    emitDisconnect() {
      disconnectListeners.forEach((listener) => listener());
    },
  };
}

describe("background helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates unique request IDs", () => {
    expect(createRequestId()).not.toBe(createRequestId());
  });

  it("normalizes unknown errors", () => {
    expect(normalizeExtensionError(new Error("Native host unavailable"))).toEqual({
      code: "EXTENSION_ERROR",
      message: "Native host unavailable",
    });
  });

  it("accepts valid native error responses", () => {
    expect(
      normalizeNativeResponse("request-1", {
        id: "request-1",
        ok: false,
        type: "error",
        code: "CACHE_READ_FAILED",
        message: "Cache read failed",
      }),
    ).toEqual({
      id: "request-1",
      ok: false,
      type: "error",
      code: "CACHE_READ_FAILED",
      message: "Cache read failed",
    });
  });

  it("accepts valid native status and cacheMiss responses", () => {
    expect(
      normalizeNativeResponse("request-1", {
        id: "request-1",
        ok: true,
        type: "status",
        installed: true,
        workflowVersion: "2026-07-18-mvp-1",
      }),
    ).toEqual({
      id: "request-1",
      ok: true,
      type: "status",
      installed: true,
      workflowVersion: "2026-07-18-mvp-1",
    });

    expect(normalizeNativeResponse("request-1", { id: "request-1", ok: true, type: "cacheMiss" })).toEqual({
      id: "request-1",
      ok: true,
      type: "cacheMiss",
    });
  });

  it("accepts valid native health responses", () => {
    expect(
      normalizeNativeResponse("request-1", {
        id: "request-1",
        ok: true,
        type: "health",
        health: {
          version: "0.1.0",
          workflowVersion: "2026-07-20-learning-cues-1",
          agent: "claude",
          cacheDir: "/Users/example/.fluent-frame/cache",
          notesFile: "/Users/example/.fluent-frame/notes.json",
          ytDlpPath: "/opt/homebrew/bin/yt-dlp",
          claudePath: "/opt/homebrew/bin/claude",
          checks: {
            ytDlp: true,
            codex: false,
            claude: true,
          },
        },
      }),
    ).toMatchObject({
      id: "request-1",
      ok: true,
      type: "health",
      health: { agent: "claude" },
    });
  });

  it("accepts valid native queue responses", () => {
    const job = {
      id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      workflowVersion: WORKFLOW_VERSION,
      status: "queued",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    };
    expect(normalizeNativeResponse("queue1", {
      id: "queue1",
      ok: true,
      type: "queueJob",
      message: "Queued",
      job,
    })).toEqual({
      id: "queue1",
      ok: true,
      type: "queueJob",
      message: "Queued",
      job,
    });
  });

  it("registers a runtime message listener", () => {
    const { runtime } = createRuntimeMock(undefined);

    registerBackgroundListener(runtime);

    expect(runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("registers a runtime message listener when chrome exists during module load", async () => {
    const { runtime } = createRuntimeMock(undefined);
    vi.stubGlobal("chrome", { runtime });
    vi.resetModules();

    await import("../src/background.js");

    expect(runtime.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("sends valid processCurrentVideo messages to the native host and forwards a valid response", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "cacheMiss",
    }));
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    const keepChannelOpen = getListener()({ type: "processCurrentVideo", videoId: "dQw4w9WgXcQ" }, {}, sendResponse);

    expect(keepChannelOpen).toBe(true);
    expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    const call = runtime.sendNativeMessage.mock.calls[0];
    if (!call) {
      throw new Error("Expected sendNativeMessage to be called");
    }
    const [hostName, request] = call;
    expect(hostName).toBe(NATIVE_HOST_NAME);
    expect(request).toMatchObject({
      type: "processVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
    });
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        id: (request as { id: string }).id,
        ok: true,
        type: "cacheMiss",
      });
    });
  });

  it("forwards queue requests to the native host", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queue",
      queue: { paused: false, jobs: [] },
    }));
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    expect(getListener()({ type: "getQueue" }, {}, sendResponse)).toBe(true);
    expect(getListener()({
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Video title",
    }, {}, sendResponse)).toBe(true);
    expect(getListener()({
      type: "removeQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    }, {}, sendResponse)).toBe(true);
    expect(getListener()({
      type: "retryQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledTimes(4);
    });
    expect(runtime.sendNativeMessage.mock.calls.map((call) => (call[1] as { type: string }).type)).toEqual([
      "getQueue",
      "enqueueVideo",
      "removeQueueJob",
      "retryQueueJob",
    ]);
    expect(runtime.sendNativeMessage.mock.calls[1]?.[1]).toMatchObject({
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Video title",
    });
  });

  it("keeps queue optional metadata within native protocol limits", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queue",
      queue: { paused: false, jobs: [] },
    }));
    const sendResponse = vi.fn();
    const longUrl = `https://www.youtube.com/watch?v=dQw4w9WgXcQ&ref=${"x".repeat(520)}`;
    const longTitle = "Title ".repeat(120);
    registerBackgroundListener(runtime);

    expect(getListener()({
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      url: longUrl,
      title: longTitle,
    }, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    });
    const request = runtime.sendNativeMessage.mock.calls[0]?.[1] as { url?: string; title?: string };
    expect(request.url).toBeUndefined();
    expect(request.title).toHaveLength(500);
  });

  it("registers Chrome context menus for queueing links and current pages", () => {
    const { runtime } = createRuntimeMock(undefined);
    const contextMenuMock = createContextMenusMock();
    const chromeApi = {
      runtime: {
        ...runtime,
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      contextMenus: contextMenuMock.contextMenus,
    };

    registerQueueContextMenus(chromeApi);

    expect(contextMenuMock.contextMenus.removeAll).toHaveBeenCalledOnce();
    expect(contextMenuMock.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(contextMenuMock.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "fluent-frame-enqueue-link-video",
      title: "Add video to FluentFrame queue",
      contexts: ["link"],
      targetUrlPatterns: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*", "https://youtu.be/*"],
    }));
    expect(contextMenuMock.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "fluent-frame-enqueue-page-video",
      title: "Add current video to FluentFrame queue",
      contexts: ["page", "video"],
      documentUrlPatterns: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*"],
    }));
    expect(contextMenuMock.contextMenus.onClicked.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.runtime.onInstalled.addListener).toHaveBeenCalledOnce();
    expect(chromeApi.runtime.onStartup.addListener).toHaveBeenCalledOnce();
  });

  it("queues a right-clicked YouTube video link through native messaging", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queueJob",
      message: "Queued",
      job: {
        id: `o3RPPjzciqo:en:${WORKFLOW_VERSION}`,
        videoId: "o3RPPjzciqo",
        captionLanguage: "en",
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    }));
    const contextMenuMock = createContextMenusMock();
    registerQueueContextMenus({ runtime, contextMenus: contextMenuMock.contextMenus });
    registerBackgroundListener(runtime);
    const sendResponse = vi.fn();
    expect(getListener()({
      type: "rememberContextMenuLink",
      url: "https://www.youtube.com/watch?v=o3RPPjzciqo&pp=ugUEEgJlbg%3D%3D",
      title: "Recommended match",
    }, { tab: { id: 42 } }, sendResponse)).toBe(false);

    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-link-video",
      linkUrl: "https://www.youtube.com/watch?v=o3RPPjzciqo&list=abc",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as chrome.contextMenus.OnClickData, {
      id: 42,
      title: "Current page title",
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    });
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({
      type: "enqueueVideo",
      videoId: "o3RPPjzciqo",
      url: "https://www.youtube.com/watch?v=o3RPPjzciqo&list=abc",
      title: "Recommended match",
    });
  });

  it("falls back to the remembered right-click link when Chrome omits linkUrl", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queueJob",
      message: "Queued",
      job: {
        id: `vZ5Bz6ILG5E:en:${WORKFLOW_VERSION}`,
        videoId: "vZ5Bz6ILG5E",
        captionLanguage: "en",
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    }));
    const contextMenuMock = createContextMenusMock();
    registerQueueContextMenus({ runtime, contextMenus: contextMenuMock.contextMenus });
    registerBackgroundListener(runtime);
    getListener()({
      type: "rememberContextMenuLink",
      url: "https://www.youtube.com/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D",
      title: "Stored recommendation",
    }, { tab: { id: 84 } }, vi.fn());

    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-link-video",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as chrome.contextMenus.OnClickData, {
      id: 84,
      title: "Current page title",
    } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    });
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({
      type: "enqueueVideo",
      videoId: "vZ5Bz6ILG5E",
      url: "https://www.youtube.com/watch?v=vZ5Bz6ILG5E&pp=ugUEEgJlbg%3D%3D",
      title: "Stored recommendation",
    });
  });

  it("queues the current watch page from the context menu", async () => {
    const { runtime } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queueJob",
      message: "Queued",
      job: {
        id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    }));
    const contextMenuMock = createContextMenusMock();
    registerQueueContextMenus({ runtime, contextMenus: contextMenuMock.contextMenus });

    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-page-video",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    } as chrome.contextMenus.OnClickData, { title: "Current video" } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    });
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      title: "Current video",
    });
  });

  it("queues a Shorts page from the context menu", async () => {
    const { runtime } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "queueJob",
      message: "Queued",
      job: {
        id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
        workflowVersion: WORKFLOW_VERSION,
        status: "queued",
        createdAt: "2026-07-21T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    }));
    const contextMenuMock = createContextMenusMock();
    registerQueueContextMenus({ runtime, contextMenus: contextMenuMock.contextMenus });

    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-page-video",
      pageUrl: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    } as chrome.contextMenus.OnClickData, { title: "Current short" } as chrome.tabs.Tab);

    await vi.waitFor(() => {
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
    });
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
      title: "Current short",
    });
  });

  it("ignores invalid context-menu targets", async () => {
    const { runtime } = createRuntimeMock(undefined);
    const contextMenuMock = createContextMenusMock();
    registerQueueContextMenus({ runtime, contextMenus: contextMenuMock.contextMenus });

    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-link-video",
      pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as chrome.contextMenus.OnClickData);
    contextMenuMock.click({
      menuItemId: "fluent-frame-enqueue-link-video",
      linkUrl: "https://www.youtube.com/results?search_query=football",
    } as chrome.contextMenus.OnClickData);
    contextMenuMock.click({
      menuItemId: "another-extension-menu",
      linkUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    } as chrome.contextMenus.OnClickData);

    await Promise.resolve();
    expect(runtime.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("relays streaming process messages between a content port and the native host port", () => {
    let contentConnectListener: ((port: MockPort) => void) | undefined;
    const nativePort = createMockPort("native");
    const contentPort = createMockPort("fluent-frame-process-video");
    const runtime = {
      lastError: undefined,
      sendNativeMessage: vi.fn(),
      connectNative: vi.fn(() => nativePort),
      onMessage: {
        addListener: vi.fn(),
      },
      onConnect: {
        addListener: vi.fn((callback: (port: MockPort) => void) => {
          contentConnectListener = callback;
        }),
      },
    } satisfies ExtensionRuntime;

    registerBackgroundListener(runtime);
    contentConnectListener?.(contentPort);
    contentPort.emitMessage({ type: "processCurrentVideoStream", videoId: "dQw4w9WgXcQ" });

    expect(runtime.connectNative).toHaveBeenCalledWith(NATIVE_HOST_NAME);
    expect(nativePort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "processVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      stream: true,
    }));

    nativePort.emitMessage({
      id: (nativePort.postMessage.mock.calls[0]?.[0] as { id: string }).id,
      ok: true,
      type: "partialResult",
      result: {
        videoId: "dQw4w9WgXcQ",
        sourceLanguage: "en",
        workflowVersion: "test",
        generatedAt: "2026-07-20T00:00:00.000Z",
        subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
        phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
      },
      completedBatches: 1,
      totalBatches: 2,
    });

    expect(contentPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      type: "partialResult",
      completedBatches: 1,
      totalBatches: 2,
    }));

    nativePort.emitMessage({
      id: (nativePort.postMessage.mock.calls[0]?.[0] as { id: string }).id,
      ok: true,
      type: "result",
      result: {
        videoId: "dQw4w9WgXcQ",
        sourceLanguage: "en",
        workflowVersion: "test",
        generatedAt: "2026-07-20T00:00:01.000Z",
        subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
        phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
      },
    });
    nativePort.emitDisconnect();
    expect(contentPort.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      code: "NATIVE_HOST_DISCONNECTED",
    }));

  });

  it("disconnects the native streaming port when the content port closes before completion", () => {
    let contentConnectListener: ((port: MockPort) => void) | undefined;
    const nativePort = createMockPort("native");
    const contentPort = createMockPort("fluent-frame-process-video");
    const runtime = {
      lastError: undefined,
      sendNativeMessage: vi.fn(),
      connectNative: vi.fn(() => nativePort),
      onMessage: {
        addListener: vi.fn(),
      },
      onConnect: {
        addListener: vi.fn((callback: (port: MockPort) => void) => {
          contentConnectListener = callback;
        }),
      },
    } satisfies ExtensionRuntime;

    registerBackgroundListener(runtime);
    contentConnectListener?.(contentPort);
    contentPort.emitMessage({ type: "processCurrentVideoStream", videoId: "dQw4w9WgXcQ" });
    contentPort.emitDisconnect();

    expect(nativePort.disconnect).toHaveBeenCalledOnce();
  });

  it("reports synchronous native streaming connection failures to the content port", () => {
    let contentConnectListener: ((port: MockPort) => void) | undefined;
    const contentPort = createMockPort("fluent-frame-process-video");
    const runtime = {
      lastError: undefined,
      sendNativeMessage: vi.fn(),
      connectNative: vi.fn(() => {
        throw new Error("No native application found");
      }),
      onMessage: {
        addListener: vi.fn(),
      },
      onConnect: {
        addListener: vi.fn((callback: (port: MockPort) => void) => {
          contentConnectListener = callback;
        }),
      },
    } satisfies ExtensionRuntime;

    registerBackgroundListener(runtime);
    contentConnectListener?.(contentPort);
    contentPort.emitMessage({ type: "processCurrentVideoStream", videoId: "dQw4w9WgXcQ" });

    expect(contentPort.postMessage).toHaveBeenCalledWith({
      id: expect.any(String),
      ok: false,
      type: "error",
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "No native application found",
    });
  });

  it("forwards healthCheck messages to the native host", async () => {
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: "health",
      health: {
        version: "0.1.0",
        workflowVersion: "2026-07-20-learning-cues-1",
        agent: "codex",
        cacheDir: "/tmp/cache",
        notesFile: "/tmp/notes.json",
        ytDlpPath: "/opt/homebrew/bin/yt-dlp",
        codexPath: "/opt/homebrew/bin/codex",
        checks: { ytDlp: true, codex: true, claude: false },
      },
    }));
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    const keepOpen = getListener()({ type: "healthCheck" }, {}, sendResponse);

    expect(keepOpen).toBe(true);
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({ type: "healthCheck" });
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, type: "health" }));
    });
  });

  it("forwards personal notes messages to the native host", async () => {
    const note = {
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
    const { runtime, getListener } = createRuntimeMock((request: unknown) => ({
      id: (request as { id: string }).id,
      ok: true,
      type: (request as { type: string }).type === "getPersonalNotes" ? "personalNotes" : "personalNotesSaved",
      notes: (request as { type: string }).type === "getPersonalNotes" ? [note] : undefined,
    }));
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    const keepGetOpen = getListener()({ type: "getPersonalNotes" }, {}, sendResponse);
    const keepSaveOpen = getListener()({ type: "savePersonalNotes", notes: [note] }, {}, sendResponse);

    expect(keepGetOpen).toBe(true);
    expect(keepSaveOpen).toBe(true);
    expect(runtime.sendNativeMessage).toHaveBeenCalledTimes(2);
    expect(runtime.sendNativeMessage.mock.calls[0]?.[1]).toMatchObject({ type: "getPersonalNotes" });
    expect(runtime.sendNativeMessage.mock.calls[1]?.[1]).toMatchObject({ type: "savePersonalNotes", notes: [note] });
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, type: "personalNotes" }));
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, type: "personalNotesSaved" }));
    });
  });

  it("returns an extension error for invalid video IDs without calling the native host", () => {
    const { runtime, getListener } = createRuntimeMock(undefined);
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    const keepChannelOpen = getListener()({ type: "processCurrentVideo", videoId: "not-valid" }, {}, sendResponse);

    expect(keepChannelOpen).toBe(false);
    expect(runtime.sendNativeMessage).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      id: expect.any(String),
      ok: false,
      type: "error",
      code: "EXTENSION_ERROR",
      message: "Invalid YouTube video ID",
    });
  });

  it("maps native lastError responses to NATIVE_HOST_UNAVAILABLE", async () => {
    const { runtime, getListener } = createRuntimeMock(undefined, { message: "No native application found" });
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    getListener()({ type: "processCurrentVideo", videoId: "dQw4w9WgXcQ" }, {}, sendResponse);

    const call = runtime.sendNativeMessage.mock.calls[0];
    if (!call) {
      throw new Error("Expected sendNativeMessage to be called");
    }
    const request = call[1] as { id: string };
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        id: request.id,
        ok: false,
        type: "error",
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "No native application found",
      });
    });
  });

  it("maps malformed native responses to INVALID_NATIVE_RESPONSE", async () => {
    const { runtime, getListener } = createRuntimeMock({ ok: true, type: "cacheMiss" });
    const sendResponse = vi.fn();
    registerBackgroundListener(runtime);

    getListener()({ type: "processCurrentVideo", videoId: "dQw4w9WgXcQ" }, {}, sendResponse);

    const call = runtime.sendNativeMessage.mock.calls[0];
    if (!call) {
      throw new Error("Expected sendNativeMessage to be called");
    }
    const request = call[1] as { id: string };
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        id: request.id,
        ok: false,
        type: "error",
        code: "INVALID_NATIVE_RESPONSE",
        message: "Invalid native host response",
      });
    });
  });
});
