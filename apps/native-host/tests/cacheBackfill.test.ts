import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillRemoteCache } from "../src/cacheBackfill.js";
import { writeCachedResult } from "../src/cache.js";
import { writeJsonFileAtomically } from "../src/jsonFile.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-cache-backfill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function result(videoId: string): LearningSubtitleResult {
  return {
    videoId,
    sourceLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    generatedAt: "2026-07-21T00:00:00.000Z",
    subtitles: [
      {
        id: 1,
        startMs: 0,
        endMs: 1000,
        english: `Sentence ${videoId}.`,
        chinese: "句子。",
        phraseIds: ["p1"],
      },
    ],
    phrases: [
      {
        id: "p1",
        cueId: 1,
        phrase: "sentence",
        meaningZh: "句子",
        explanationEn: "A generated sentence.",
        difficulty: "basic",
      },
    ],
  };
}

describe("backfillRemoteCache", () => {
  it("uploads missing local cache results and skips stale cache directories", async () => {
    const uploaded: string[] = [];
    const staleResult = result("staleVideo01");
    await writeCachedResult(dir, result("missingOne1"));
    await writeCachedResult(dir, result("alreadyHere"));
    await mkdir(join(dir, "staleVideo01", "en.stale-20260719", WORKFLOW_VERSION), { recursive: true });
    await writeJsonFileAtomically(join(dir, "staleVideo01", "en.stale-20260719", WORKFLOW_VERSION, "result.json"), staleResult);

    const summary = await backfillRemoteCache({
      cacheDir: dir,
      remoteCache: {
        readResult: async (videoId) => videoId === "alreadyHere" ? result(videoId) : undefined,
        writeResult: async (cachedResult) => {
          uploaded.push(cachedResult.videoId);
        },
      },
    });

    expect(summary).toEqual({ scanned: 2, uploaded: 1, skippedExisting: 1, skippedInvalid: 0, failed: 0 });
    expect(uploaded).toEqual(["missingOne1"]);
  });

  it("limits uploads per backfill run", async () => {
    const uploaded: string[] = [];
    await writeCachedResult(dir, result("missingOne1"));
    await writeCachedResult(dir, result("missingTwo2"));

    const summary = await backfillRemoteCache({
      cacheDir: dir,
      maxUploads: 1,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async (cachedResult) => {
          uploaded.push(cachedResult.videoId);
        },
      },
    });

    expect(summary).toMatchObject({ scanned: 1, uploaded: 1 });
    expect(uploaded).toHaveLength(1);
  });
});
