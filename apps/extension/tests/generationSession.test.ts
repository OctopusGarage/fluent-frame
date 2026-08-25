import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { describe, expect, it, vi } from "vitest";
import { createVideoLearningSession } from "../src/generationSession.js";
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
});
