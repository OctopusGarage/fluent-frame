import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processVideo } from "../src/processor.js";

describe("processVideo events and provenance", () => {
  it("emits progress and partial events through one process-event seam", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "ff-process-events-"));
    const events: string[] = [];
    try {
      const output = await processVideo("dQw4w9WgXcQ", "en", {
        cacheDir,
        downloadCaptions: async () => "1\n00:00:00,000 --> 00:00:01,000\nNice pass.\n",
        runAgent: async (_captionText, options) => {
          await options?.onBatch?.({
            completedBatches: 1,
            totalBatches: 1,
            output: {
              subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
              phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
            },
          });
          return {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
            phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
          };
        },
        onEvent: async (event) => {
          events.push(event.type);
        },
      });

      expect(events).toEqual(["cacheStatus", "partialResult"]);
      expect(output.mode).toBe("generated");
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("marks source-only fallback explicitly", async () => {
    const output = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: "/tmp/fluent-frame-process-events-fallback-test",
      downloadCaptions: async () => "1\n00:00:00,000 --> 00:00:01,000\nSource only.\n",
      runAgent: async () => {
        throw new Error("Codex timed out after 120 seconds");
      },
    });

    expect(output.mode).toBe("sourceFallback");
    expect(output.fallbackReason).toBe("Codex timed out after 120 seconds");
    expect(output.result.phrases).toEqual([]);
  });
});
