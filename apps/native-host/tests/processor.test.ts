import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_VERSION } from "@fluent-frame/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processVideo } from "../src/processor.js";
import { readCachedResult } from "../src/cache.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-process-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("processVideo", () => {
  it("returns cached result on second call", async () => {
    let downloads = 0;
    const deps = {
      cacheDir: dir,
      downloadCaptions: async () => {
        downloads += 1;
        return "1\n00:00:00,000 --> 00:00:01,000\nNice pass.\n";
      },
      runAgent: async () => ({
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
            difficulty: "basic" as const,
          },
        ],
      }),
    };
    const first = await processVideo("dQw4w9WgXcQ", "en", deps);
    const second = await processVideo("dQw4w9WgXcQ", "en", deps);
    expect(first.result).toEqual(second.result);
    expect(downloads).toBe(1);
  });

  it("regenerates when the current workflow cache file is corrupt", async () => {
    const cachePath = join(dir, "dQw4w9WgXcQ", "en", WORKFLOW_VERSION, "result.json");
    await mkdir(join(cachePath, ".."), { recursive: true });
    await writeFile(cachePath, "{", "utf8");
    let downloads = 0;

    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => {
        downloads += 1;
        return "1\n00:00:00,000 --> 00:00:01,000\nNice pass.\n";
      },
      runAgent: async () => ({
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
            difficulty: "basic" as const,
          },
        ],
      }),
    });

    expect(processed.cacheHit).toBe(false);
    expect(processed.result.subtitles[0]?.english).toBe("Nice pass.");
    expect(downloads).toBe(1);
  });

  it("preserves downloaded source cue timing when agent output changes timing", async () => {
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:03,960
Tonight we're in for an all-action affair,

2
00:00:01,960 --> 00:00:08,120
and may the best team win,
`,
      runAgent: async () => ({
        subtitles: [
          {
            id: 1,
            startMs: 0,
            endMs: 30_000,
            english: "Tonight we're in for an all-action affair,",
            chinese: "今晚必将是一场激烈大战，",
            phraseIds: ["p1"],
          },
          {
            id: 2,
            startMs: 30_000,
            endMs: 35_000,
            english: "and may the best team win,",
            chinese: "愿更强的一方获胜，",
            phraseIds: ["p2"],
          },
        ],
        phrases: [
          {
            id: "p1",
            cueId: 1,
            phrase: "all-action affair",
            meaningZh: "激烈比赛",
            explanationEn: "A match with lots of action.",
            difficulty: "useful" as const,
          },
          {
            id: "p2",
            cueId: 2,
            phrase: "may the best team win",
            meaningZh: "愿强者胜",
            explanationEn: "A polite contest phrase.",
            difficulty: "basic" as const,
          },
        ],
      }),
    });

    expect(processed.result.subtitles).toMatchObject([
      { id: 1, startMs: 0, endMs: 3960, english: "Tonight we're in for an all-action affair," },
      { id: 2, startMs: 1960, endMs: 8120, english: "and may the best team win," },
    ]);
  });

  it("fills source subtitle cues that the agent skipped so playback never loses subtitle data", async () => {
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Translated cue.

2
00:00:01,000 --> 00:00:02,000
Skipped by agent.
`,
      runAgent: async () => ({
        subtitles: [
          {
            id: 1,
            startMs: 0,
            endMs: 1000,
            english: "Translated cue.",
            chinese: "已翻译字幕。",
            phraseIds: ["p1"],
          },
        ],
        phrases: [
          {
            id: "p1",
            cueId: 1,
            phrase: "translated cue",
            meaningZh: "已翻译字幕",
            explanationEn: "A cue returned by the agent.",
            difficulty: "basic" as const,
          },
        ],
      }),
    });

    expect(processed.result.subtitles).toEqual([
      {
        id: 1,
        startMs: 0,
        endMs: 1000,
        english: "Translated cue.",
        chinese: "已翻译字幕。",
        phraseIds: ["p1"],
      },
      {
        id: 2,
        startMs: 1000,
        endMs: 2000,
        english: "Skipped by agent.",
        chinese: "",
        phraseIds: [],
      },
    ]);
  });

  it("returns full source subtitles when the local agent fails or times out", async () => {
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Source one.

2
00:00:01,000 --> 00:00:02,000
Source two.
`,
      runAgent: async () => {
        throw new Error("Codex timed out after 120 seconds");
      },
    });

    expect(processed.result.phrases).toEqual([]);
    expect(processed.result.subtitles).toEqual([
      { id: 1, startMs: 0, endMs: 1000, english: "Source one.", chinese: "", phraseIds: [] },
      { id: 2, startMs: 1000, endMs: 2000, english: "Source two.", chinese: "", phraseIds: [] },
    ]);
  });

  it("does not cache source-only fallback results as generated learning subtitles", async () => {
    await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Source only.
`,
      runAgent: async () => {
        throw new Error("Codex timed out after 120 seconds");
      },
    });

    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });
});
