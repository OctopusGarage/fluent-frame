import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoLearningSession } from "../src/generationSession.js";
import type { LearningGenerationHandlers } from "../src/learningGenerationClient.js";
import type { CoachUi } from "../src/ui.js";

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: "test",
  generatedAt: "2026-07-21T00:00:00.000Z",
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
};

function createUi(): CoachUi {
  return {
    mount: vi.fn(),
    togglePanel: vi.fn(),
    resetUiState: vi.fn(),
    setStatus: vi.fn(),
    setProgress: vi.fn(),
    setError: vi.fn(),
    clearResult: vi.fn(),
    setResult: vi.fn(),
    sync: vi.fn(),
    placeSubtitleOverlay: vi.fn(),
    attachPlayerButton: vi.fn(),
  };
}

describe("VideoLearningSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps generation started on the new video before the navigation poll", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const ui = createUi();
    let currentVideoId = "o3RPPjzciqo";
    const requests: Array<{ handlers: LearningGenerationHandlers; disconnect: ReturnType<typeof vi.fn> }> = [];
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, handlers) {
          const request = { handlers, disconnect: vi.fn() };
          requests.push(request);
          return request;
        },
      },
      ui,
      currentVideoId: () => currentVideoId,
      reconcilePlayerUi: vi.fn(),
    });

    session.start(currentVideoId);
    currentVideoId = result.videoId;
    session.start(currentVideoId);
    session.handleNavigation(currentVideoId);

    expect(requests[0]?.disconnect).toHaveBeenCalledOnce();
    expect(requests[1]?.disconnect).not.toHaveBeenCalled();
    expect(ui.clearResult).not.toHaveBeenLastCalledWith("Ready");
    requests[1]?.handlers.onResult(result);
    expect(ui.setResult).toHaveBeenCalledWith(result, expect.stringContaining("Learning subtitles ready"));
    session.cancel();
  });

  it.each(["success", "fallback", "error", "disconnect"] as const)("releases the request and progress timer after %s", (outcome) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const ui = createUi();
    let handlers: LearningGenerationHandlers | undefined;
    const disconnect = vi.fn(() => handlers?.onDisconnect());
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, nextHandlers) {
          handlers = nextHandlers;
          return { disconnect };
        },
      },
      ui,
      currentVideoId: () => result.videoId,
      reconcilePlayerUi: vi.fn(),
    });

    session.start(result.videoId);
    if (outcome === "error") handlers?.onError("Generation timed out");
    else if (outcome === "disconnect") handlers?.onDisconnect();
    else handlers?.onResult(result, outcome === "fallback" ? { mode: "partialFallback" } : undefined);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    if (outcome === "error") expect(ui.setError).toHaveBeenLastCalledWith("Generation timed out");
    else if (outcome === "disconnect") expect(ui.setError).toHaveBeenCalledOnce();
    else expect(ui.setError).not.toHaveBeenCalled();
    session.cancel();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("releases a request that finishes synchronously before start returns", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const ui = createUi();
    const disconnect = vi.fn();
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, handlers) {
          handlers.onResult(result);
          return { disconnect };
        },
      },
      ui,
      currentVideoId: () => result.videoId,
      reconcilePlayerUi: vi.fn(),
    });

    session.start(result.videoId);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(ui.setResult).toHaveBeenCalledWith(result, expect.stringContaining("Learning subtitles ready"));
  });

  it("does not start duplicate generation for the same active video", () => {
    const ui = createUi();
    const start = vi.fn(() => ({ disconnect: vi.fn() }));
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: { start },
      ui,
      currentVideoId: () => "dQw4w9WgXcQ",
      reconcilePlayerUi: vi.fn(),
    });

    session.start("dQw4w9WgXcQ");
    session.start("dQw4w9WgXcQ");

    expect(start).toHaveBeenCalledOnce();
    expect(ui.setProgress).toHaveBeenCalledWith(expect.stringContaining("Already generating this video"));
  });

  it("renders successful generation through the client seam", () => {
    const ui = createUi();
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, handlers) {
          handlers.onResult(result);
          return { disconnect: vi.fn() };
        },
      },
      ui,
      currentVideoId: () => "dQw4w9WgXcQ",
      reconcilePlayerUi: vi.fn(),
    });

    session.start("dQw4w9WgXcQ");

    expect(ui.setResult).toHaveBeenCalledWith(result, expect.stringContaining("Learning subtitles ready in"));
  });

  it("renders partial fallback results as incomplete instead of ready", () => {
    const ui = createUi();
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, handlers) {
          handlers.onResult(result, { mode: "partialFallback", fallbackReason: "Codex timed out after 120 seconds" });
          return { disconnect: vi.fn() };
        },
      },
      ui,
      currentVideoId: () => "dQw4w9WgXcQ",
      reconcilePlayerUi: vi.fn(),
    });

    session.start("dQw4w9WgXcQ");

    expect(ui.setResult).toHaveBeenCalledWith(result, expect.stringContaining("Partial subtitles saved"));
    expect(ui.setResult).not.toHaveBeenCalledWith(result, expect.stringContaining("Learning subtitles ready"));
  });

  it("ignores a result after navigation away from a video", () => {
    const ui = createUi();
    let currentVideoId: string | undefined = "dQw4w9WgXcQ";
    let handlers: { onResult(result: LearningSubtitleResult): void } | undefined;
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, nextHandlers) {
          handlers = nextHandlers;
          return { disconnect: vi.fn() };
        },
      },
      ui,
      currentVideoId: () => currentVideoId,
      reconcilePlayerUi: vi.fn(),
    });

    session.start("dQw4w9WgXcQ");
    currentVideoId = undefined;
    session.handleNavigation(undefined);
    handlers?.onResult(result);

    expect(ui.setResult).not.toHaveBeenCalledWith(result, expect.any(String));
  });

  it("cancels active generation when navigating away from video pages", () => {
    const ui = createUi();
    let currentVideoId: string | undefined = "dQw4w9WgXcQ";
    const disconnect = vi.fn();
    let handlers: { onDisconnect(): void } | undefined;
    const session = createVideoLearningSession({
      doc: document,
      win: window,
      generationClient: {
        start(_videoId, nextHandlers) {
          handlers = nextHandlers;
          return { disconnect };
        },
      },
      ui,
      currentVideoId: () => currentVideoId,
      reconcilePlayerUi: vi.fn(),
    });

    session.start("dQw4w9WgXcQ");
    currentVideoId = undefined;
    session.handleNavigation(undefined);
    handlers?.onDisconnect();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(ui.setError).not.toHaveBeenCalledWith("Local helper disconnected before generation finished.");
    expect(ui.clearResult).toHaveBeenLastCalledWith("Ready");
  });
});
