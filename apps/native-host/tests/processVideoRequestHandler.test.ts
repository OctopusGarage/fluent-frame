import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_VERSION, type HostResponse, type LearningSubtitleResult } from "@fluent-frame/shared";
import type { HostConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const runVideoProcessingPipeline = vi.hoisted(() => vi.fn());

vi.mock("../src/videoProcessingPipeline.js", () => ({
  runVideoProcessingPipeline,
}));

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: WORKFLOW_VERSION,
  generatedAt: "2026-07-21T00:00:00.000Z",
  subtitles: [
    {
      id: 1,
      startMs: 0,
      endMs: 1000,
      english: "Nice pass.",
      chinese: "传得漂亮。",
      phraseIds: ["p1"],
    },
  ],
  phrases: [
    {
      id: "p1",
      cueId: 1,
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
      difficulty: "basic",
    },
  ],
};

describe("handleProcessVideoRequest", () => {
  beforeEach(() => {
    runVideoProcessingPipeline.mockReset();
  });

  it("emits streaming progress and partial results before the final result", async () => {
    const { handleProcessVideoRequest } = await import("../src/processVideoRequestHandler.js");
    const logger: Logger = { log: vi.fn(async () => undefined) };
    const emitted: HostResponse[] = [];
    runVideoProcessingPipeline.mockImplementation(async (_config: HostConfig, options: { onEvent?: (event: unknown) => void }) => {
      options.onEvent?.({ type: "partialResult", result, completedBatches: 1, totalBatches: 2 });
      options.onEvent?.({ type: "fallback", mode: "partialFallback", reason: "agent exited early" });
      return { mode: "generated", result };
    });

    await expect(
      handleProcessVideoRequest(
        { id: "process1", type: "processVideo", videoId: "dQw4w9WgXcQ", captionLanguage: "en", stream: true },
        { config: {} as HostConfig, logger, emit: (response) => emitted.push(response) },
      ),
    ).resolves.toEqual({ id: "process1", ok: true, type: "result", result });

    expect(emitted).toEqual([
      {
        id: "process1",
        ok: true,
        type: "progress",
        progress: { stage: "download", message: "Downloading YouTube captions" },
      },
      {
        id: "process1",
        ok: true,
        type: "progress",
        progress: {
          stage: "agent",
          message: "Generated batch 1 of 2",
          completedBatches: 1,
          totalBatches: 2,
        },
      },
      { id: "process1", ok: true, type: "partialResult", result, completedBatches: 1, totalBatches: 2 },
      {
        id: "process1",
        ok: true,
        type: "progress",
        progress: { stage: "agent", message: "Using partial learning subtitles: agent exited early" },
      },
      {
        id: "process1",
        ok: true,
        type: "progress",
        progress: { stage: "done", message: "Finalizing learning subtitles" },
      },
    ]);
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({ event: "generation.partial" }));
  });

  it("logs and returns processing errors without emitting stream completion", async () => {
    const { handleProcessVideoRequest } = await import("../src/processVideoRequestHandler.js");
    const logger: Logger = { log: vi.fn(async () => undefined) };
    const emitted: HostResponse[] = [];
    runVideoProcessingPipeline.mockRejectedValue(new Error("yt-dlp failed"));

    await expect(
      handleProcessVideoRequest(
        { id: "process2", type: "processVideo", videoId: "dQw4w9WgXcQ", captionLanguage: "en", stream: true },
        { config: {} as HostConfig, logger, emit: (response) => emitted.push(response) },
      ),
    ).resolves.toEqual({
      id: "process2",
      ok: false,
      type: "error",
      code: "PROCESSING_ERROR",
      message: "yt-dlp failed",
    });

    expect(emitted).toEqual([
      {
        id: "process2",
        ok: true,
        type: "progress",
        progress: { stage: "download", message: "Downloading YouTube captions" },
      },
    ]);
    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({ event: "generation.failed" }));
  });
});
