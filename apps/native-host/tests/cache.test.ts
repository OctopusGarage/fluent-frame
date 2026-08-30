import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import {
  clearCachedResult,
  listCachedVideoSummaries,
  markCachedVideoWatched,
  readCachedResult,
  writeCachedResult,
} from "../src/cache.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

describe("cache", () => {
  async function writeRawResult(content: string): Promise<void> {
    const path = join(dir, "dQw4w9WgXcQ", "en", WORKFLOW_VERSION, "result.json");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  it("writes, reads, and clears a result", async () => {
    await writeCachedResult(dir, result);
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toEqual(result);
    await clearCachedResult(dir, "dQw4w9WgXcQ", "en");
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("does not clear sibling workflow version cache data", async () => {
    const siblingPath = join(dir, "dQw4w9WgXcQ", "en", "2026-07-18-mvp-0", "result.json");
    await mkdir(join(siblingPath, ".."), { recursive: true });
    await writeFile(siblingPath, "{}\n", "utf8");

    await writeCachedResult(dir, result);
    await clearCachedResult(dir, "dQw4w9WgXcQ", "en");

    await expect(access(siblingPath)).resolves.toBeUndefined();
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("rejects invalid JSON cache files with a cache error", async () => {
    await writeRawResult("{");

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).rejects.toThrow("Invalid cached subtitle result");
  });

  it("rejects structurally invalid cache results with matching metadata", async () => {
    await writeRawResult(
      JSON.stringify({
        videoId: "dQw4w9WgXcQ",
        sourceLanguage: "en",
        workflowVersion: WORKFLOW_VERSION,
        generatedAt: "2026-07-18T00:00:00.000Z",
      }),
    );

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).rejects.toThrow("Invalid cached subtitle result");
  });

  it("rejects cached results with no subtitles or phrases", async () => {
    await writeRawResult(JSON.stringify({ ...result, subtitles: [], phrases: [] }));

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).rejects.toThrow("Invalid cached subtitle result");
  });

  it("rejects cached results with phrase references that do not match subtitles", async () => {
    await writeRawResult(
      JSON.stringify({
        ...result,
        subtitles: [{ ...result.subtitles[0], phraseIds: ["missing"] }],
      }),
    );

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).rejects.toThrow("Invalid cached subtitle result");
  });

  it("returns undefined for cache metadata mismatches", async () => {
    await writeRawResult(JSON.stringify({ ...result, videoId: "aaaaaaaaaaa" }));

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("lists cached subtitle results by recent watch time", async () => {
    const older = { ...result, videoId: "aaaaaaaaaaa", generatedAt: "2026-07-20T00:00:00.000Z" };
    const newer = { ...result, videoId: "bbbbbbbbbbb", generatedAt: "2026-07-21T00:00:00.000Z" };
    await writeCachedResult(dir, older);
    await writeCachedResult(dir, newer);
    await markCachedVideoWatched(dir, "aaaaaaaaaaa", "en", "2026-07-24T00:00:00.000Z");
    await markCachedVideoWatched(dir, "bbbbbbbbbbb", "en", "2026-07-23T00:00:00.000Z");

    await expect(listCachedVideoSummaries(dir)).resolves.toMatchObject([
      {
        videoId: "aaaaaaaaaaa",
        captionLanguage: "en",
        lastWatchedAt: "2026-07-24T00:00:00.000Z",
        subtitleCount: 1,
        phraseCount: 1,
      },
      {
        videoId: "bbbbbbbbbbb",
        captionLanguage: "en",
        lastWatchedAt: "2026-07-23T00:00:00.000Z",
      },
    ]);
  });

  it("includes cached video titles in subtitle result summaries", async () => {
    await writeCachedResult(dir, result);
    await markCachedVideoWatched(dir, "dQw4w9WgXcQ", "en", "2026-07-24T00:00:00.000Z", "Never Gonna Give You Up");

    await expect(listCachedVideoSummaries(dir)).resolves.toMatchObject([
      {
        videoId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
      },
    ]);
  });
});
