import { NATIVE_HOST_NAME } from "@fluent-frame/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRequestId,
  normalizeExtensionError,
  normalizeNativeResponse,
  registerBackgroundListener,
  type ExtensionRuntime,
} from "../src/background.js";

type RuntimeMessageCallback = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean;
type NativeResponseFactory = (request: unknown) => unknown;

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
