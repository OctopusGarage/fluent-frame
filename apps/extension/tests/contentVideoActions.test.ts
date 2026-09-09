import { describe, expect, it, vi } from "vitest";
import { createContentVideoActions } from "../src/contentVideoActions.js";
import type { ContentScriptRuntime } from "../src/learningGenerationClient.js";

function createRuntime(options: {
  response?: unknown;
  lastError?: { message?: string };
  sendThrows?: unknown;
} = {}): ContentScriptRuntime {
  return {
    lastError: options.lastError,
    sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      if (options.sendThrows) {
        throw options.sendThrows;
      }
      callback(options.response);
    }),
  };
}

describe("createContentVideoActions", () => {
  it("queues videos through the content runtime", () => {
    const runtime = createRuntime({
      response: { id: "queue-1", ok: true, type: "queueJob", message: "Already queued" },
    });
    const actions = createContentVideoActions(runtime, { fallbackTitle: () => "Fallback title" });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    actions.enqueueVideo({ videoId: "dQw4w9WgXcQ", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", title: "Demo" }, {
      onSuccess,
      onError,
    });

    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { type: "enqueueVideo", videoId: "dQw4w9WgXcQ", url: "https://youtube.com/watch?v=dQw4w9WgXcQ", title: "Demo" },
      expect.any(Function),
    );
    expect(onSuccess).toHaveBeenCalledWith("Already queued");
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces queue runtime errors", () => {
    const runtime = createRuntime({ lastError: { message: "No receiving end" } });
    const actions = createContentVideoActions(runtime, { fallbackTitle: () => undefined });
    const onError = vi.fn();

    actions.enqueueVideo({ videoId: "dQw4w9WgXcQ" }, { onError });

    expect(onError).toHaveBeenCalledWith("No receiving end");
  });

  it("normalizes synchronous invalidated-context queue errors", () => {
    const runtime = createRuntime({
      sendThrows: new Error("Extension context invalidated."),
    });
    const actions = createContentVideoActions(runtime, { fallbackTitle: () => undefined });
    const onError = vi.fn();

    actions.enqueueVideo({ videoId: "dQw4w9WgXcQ" }, { onError });

    expect(onError).toHaveBeenCalledWith("Extension was reloaded. Refresh this YouTube tab.");
  });

  it("marks watched videos with normalized fallback titles", () => {
    const runtime = createRuntime();
    const actions = createContentVideoActions(runtime, { fallbackTitle: () => "  A   Video  Title  " });

    actions.markVideoWatched({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });

    expect(runtime.sendMessage).toHaveBeenCalledWith(
      { type: "markCachedVideoWatched", videoId: "dQw4w9WgXcQ", captionLanguage: "en", title: "A Video Title" },
      expect.any(Function),
    );
  });

  it("remembers context-menu links without exposing runtime details to callers", () => {
    const runtime = createRuntime();
    const actions = createContentVideoActions(runtime, { fallbackTitle: () => undefined });

    actions.rememberContextMenuLink({
      videoId: "dQw4w9WgXcQ",
      url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Recommendation",
    });

    expect(runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: "rememberContextMenuLink",
        videoId: "dQw4w9WgXcQ",
        url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        title: "Recommendation",
      },
      expect.any(Function),
    );
  });
});
