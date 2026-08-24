import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";

const writes: string[] = [];
const renames: Array<{ from: string; to: string }> = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async (path: Parameters<typeof actual.writeFile>[0]) => {
      writes.push(String(path));
      if (String(path).endsWith("result.json")) {
        throw new Error("cache result was written directly");
      }
    }),
    rename: vi.fn(async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      renames.push({ from: String(from), to: String(to) });
    }),
  };
});

const { writeCachedResult } = await import("../src/cache.js");

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: WORKFLOW_VERSION,
  generatedAt: "2026-07-18T00:00:00.000Z",
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
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

describe("cache atomic writes", () => {
  beforeEach(() => {
    writes.length = 0;
    renames.length = 0;
  });

  it("publishes cache results with rename instead of writing result.json directly", async () => {
    const resultPath = join("/tmp/ff-cache", "dQw4w9WgXcQ", "en", WORKFLOW_VERSION, "result.json");

    await writeCachedResult("/tmp/ff-cache", result);

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toBe(resultPath);
    expect(renames).toEqual([{ from: writes[0], to: resultPath }]);
  });
});
