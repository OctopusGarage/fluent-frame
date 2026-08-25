import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_VERSION } from "@fluent-frame/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processVideo } from "../src/processor.js";
import { readCachedPartialResult, readCachedResult } from "../src/cache.js";

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

  it("emits partial learning subtitle results when the agent reports completed batches", async () => {
    const partials: Array<{ completedBatches: number; totalBatches: number; cueIds: number[] }> = [];
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
First line.

2
00:00:01,000 --> 00:00:02,000
Second line.
`,
      runAgent: async (_captionText, options) => {
        await options?.onBatch?.({
          completedBatches: 1,
          totalBatches: 2,
          output: {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] }],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        await options?.onBatch?.({
          completedBatches: 2,
          totalBatches: 2,
          output: {
            subtitles: [
              { id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] },
              { id: 2, startMs: 0, endMs: 1000, english: "Second line.", chinese: "第二句。", phraseIds: ["p2"] },
            ],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
              {
                id: "p2",
                cueId: 2,
                phrase: "second line",
                meaningZh: "第二句",
                explanationEn: "Follow-up sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        return {
          subtitles: [
            { id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] },
            { id: 2, startMs: 0, endMs: 1000, english: "Second line.", chinese: "第二句。", phraseIds: ["p2"] },
          ],
          phrases: [
            {
              id: "p1",
              cueId: 1,
              phrase: "first line",
              meaningZh: "第一句",
              explanationEn: "Opening sentence.",
              difficulty: "basic" as const,
            },
            {
              id: "p2",
              cueId: 2,
              phrase: "second line",
              meaningZh: "第二句",
              explanationEn: "Follow-up sentence.",
              difficulty: "basic" as const,
            },
          ],
        };
      },
      onPartialResult: async (result, progress) => {
        partials.push({
          completedBatches: progress.completedBatches,
          totalBatches: progress.totalBatches,
          cueIds: result.subtitles.filter((subtitle) => subtitle.chinese).map((subtitle) => subtitle.id),
        });
      },
    });

    expect(partials).toEqual([
      { completedBatches: 1, totalBatches: 2, cueIds: [1] },
      { completedBatches: 2, totalBatches: 2, cueIds: [1, 2] },
    ]);
    expect(processed.result.subtitles[1]).toMatchObject({ id: 2, startMs: 1000, endMs: 2000, chinese: "第二句。" });
  });

  it("keeps the last successful partial batch if a later agent batch fails", async () => {
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
First line.

2
00:00:01,000 --> 00:00:02,000
Second line.
`,
      runAgent: async (_captionText, options) => {
        await options?.onBatch?.({
          completedBatches: 1,
          totalBatches: 2,
          output: {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] }],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        throw new Error("Second batch failed");
      },
    });

    expect(processed.result.subtitles).toEqual([
      { id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] },
      { id: 2, startMs: 1000, endMs: 2000, english: "Second line.", chinese: "", phraseIds: [] },
    ]);
    expect(processed.result.phrases).toHaveLength(1);
  });

  it("does not persist partial fallback results as complete cache entries", async () => {
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
First line.

2
00:00:01,000 --> 00:00:02,000
Second line.
`,
      runAgent: async (_captionText, options) => {
        await options?.onBatch?.({
          completedBatches: 1,
          totalBatches: 2,
          output: {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] }],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        throw new Error("Second batch failed");
      },
    });

    expect(processed.mode).toBe("partialFallback");
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("persists partial fallback checkpoints and resumes from them on retry", async () => {
    const captionText = `1
00:00:00,000 --> 00:00:01,000
First line.

2
00:00:01,000 --> 00:00:02,000
Second line.
`;
    let runs = 0;

    const first = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => captionText,
      runAgent: async (_captionText, options) => {
        runs += 1;
        await options?.onBatch?.({
          completedBatches: 1,
          totalBatches: 2,
          output: {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] }],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        throw new Error("Second batch failed");
      },
    });

    expect(first.mode).toBe("partialFallback");
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
    await expect(readCachedPartialResult(dir, "dQw4w9WgXcQ", "en")).resolves.toMatchObject({
      completedBatches: 1,
      totalBatches: 2,
      result: { subtitles: expect.arrayContaining([expect.objectContaining({ id: 1, chinese: "第一句。" })]) },
    });

    const partialEvents: number[] = [];
    const second = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      downloadCaptions: async () => captionText,
      runAgent: async (_captionText, options) => {
        runs += 1;
        expect(options?.resumeFrom).toMatchObject({ completedBatches: 1, totalBatches: 2 });
        await options?.onBatch?.({
          completedBatches: 2,
          totalBatches: 2,
          output: {
            subtitles: [
              { id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] },
              { id: 2, startMs: 0, endMs: 1000, english: "Second line.", chinese: "第二句。", phraseIds: ["p2"] },
            ],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
              {
                id: "p2",
                cueId: 2,
                phrase: "second line",
                meaningZh: "第二句",
                explanationEn: "Follow-up sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        return {
          subtitles: [
            { id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] },
            { id: 2, startMs: 0, endMs: 1000, english: "Second line.", chinese: "第二句。", phraseIds: ["p2"] },
          ],
          phrases: [
            {
              id: "p1",
              cueId: 1,
              phrase: "first line",
              meaningZh: "第一句",
              explanationEn: "Opening sentence.",
              difficulty: "basic" as const,
            },
            {
              id: "p2",
              cueId: 2,
              phrase: "second line",
              meaningZh: "第二句",
              explanationEn: "Follow-up sentence.",
              difficulty: "basic" as const,
            },
          ],
        };
      },
      onEvent: (event) => {
        if (event.type === "partialResult") {
          partialEvents.push(event.completedBatches);
        }
      },
    });

    expect(runs).toBe(2);
    expect(partialEvents).toEqual([1, 2]);
    expect(second.mode).toBe("generated");
    await expect(readCachedPartialResult(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toEqual(second.result);
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

  it("reuses cached captions after agent failure so retries do not download subtitles again", async () => {
    let downloads = 0;
    let agentRuns = 0;
    let cachedCaptionText: string | undefined;
    const deps = {
      cacheDir: dir,
      readCachedCaptions: async () => cachedCaptionText,
      writeCachedCaptions: async (_videoId: string, _captionLanguage: string, captionText: string) => {
        cachedCaptionText = captionText;
      },
      downloadCaptions: async () => {
        downloads += 1;
        return `1
00:00:00,000 --> 00:00:01,000
Source one.
`;
      },
      runAgent: async () => {
        agentRuns += 1;
        throw new Error("Codex timed out after 120 seconds");
      },
    };

    const first = await processVideo("dQw4w9WgXcQ", "en", deps);
    const second = await processVideo("dQw4w9WgXcQ", "en", deps);

    expect(first.mode).toBe("sourceFallback");
    expect(second.mode).toBe("sourceFallback");
    expect(downloads).toBe(1);
    expect(agentRuns).toBe(2);
  });

  it("hydrates local cache from a remote cache hit without downloading captions or running the agent", async () => {
    const remoteResult = {
      videoId: "dQw4w9WgXcQ",
      sourceLanguage: "en",
      workflowVersion: WORKFLOW_VERSION,
      generatedAt: "2026-07-21T00:00:00.000Z",
      subtitles: [
        {
          id: 1,
          startMs: 0,
          endMs: 1000,
          english: "Remote sentence.",
          chinese: "远程句子。",
          phraseIds: ["p1"],
        },
      ],
      phrases: [
        {
          id: "p1",
          cueId: 1,
          phrase: "remote sentence",
          meaningZh: "远程句子",
          explanationEn: "A sentence loaded from GitHub cache.",
          difficulty: "basic" as const,
        },
      ],
    };
    let downloads = 0;
    let agentRuns = 0;

    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      remoteCache: {
        readResult: async () => remoteResult,
        writeResult: async () => {
          throw new Error("remote hits should not upload");
        },
      },
      downloadCaptions: async () => {
        downloads += 1;
        return "";
      },
      runAgent: async () => {
        agentRuns += 1;
        return { subtitles: [], phrases: [] };
      },
    });

    expect(processed).toMatchObject({ cacheHit: true, mode: "remoteCache", result: remoteResult });
    expect(downloads).toBe(0);
    expect(agentRuns).toBe(0);
    await expect(readCachedResult(dir, "dQw4w9WgXcQ", "en")).resolves.toEqual(remoteResult);
  });

  it("uploads generated learning subtitles to remote cache after local generation succeeds", async () => {
    const uploaded: unknown[] = [];
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async (result) => {
          uploaded.push(result);
        },
      },
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Generated sentence.
`,
      runAgent: async () => ({
        subtitles: [
          {
            id: 1,
            startMs: 0,
            endMs: 1000,
            english: "Generated sentence.",
            chinese: "生成句子。",
            phraseIds: ["p1"],
          },
        ],
        phrases: [
          {
            id: "p1",
            cueId: 1,
            phrase: "generated sentence",
            meaningZh: "生成句子",
            explanationEn: "A sentence generated by the local agent.",
            difficulty: "basic" as const,
          },
        ],
      }),
    });

    expect(processed.mode).toBe("generated");
    expect(uploaded).toEqual([processed.result]);
  });

  it("backfills local cache entries after a new generation uploads successfully", async () => {
    let backfills = 0;
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async () => undefined,
      },
      backfillRemoteCache: async () => {
        backfills += 1;
      },
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Generated sentence.
`,
      runAgent: async () => ({
        subtitles: [
          {
            id: 1,
            startMs: 0,
            endMs: 1000,
            english: "Generated sentence.",
            chinese: "生成句子。",
            phraseIds: ["p1"],
          },
        ],
        phrases: [
          {
            id: "p1",
            cueId: 1,
            phrase: "generated sentence",
            meaningZh: "生成句子",
            explanationEn: "A sentence generated by the local agent.",
            difficulty: "basic" as const,
          },
        ],
      }),
    });

    expect(processed.mode).toBe("generated");
    expect(backfills).toBe(1);
  });

  it("does not upload partial fallback results to remote cache", async () => {
    let uploads = 0;
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async () => {
          uploads += 1;
        },
      },
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
First line.

2
00:00:01,000 --> 00:00:02,000
Second line.
`,
      runAgent: async (_captionText, options) => {
        await options?.onBatch?.({
          completedBatches: 1,
          totalBatches: 2,
          output: {
            subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "First line.", chinese: "第一句。", phraseIds: ["p1"] }],
            phrases: [
              {
                id: "p1",
                cueId: 1,
                phrase: "first line",
                meaningZh: "第一句",
                explanationEn: "Opening sentence.",
                difficulty: "basic" as const,
              },
            ],
          },
        });
        throw new Error("Second batch failed");
      },
    });

    expect(processed.mode).toBe("partialFallback");
    expect(uploads).toBe(0);
  });

  it("does not upload source-only fallback results to remote cache", async () => {
    let uploads = 0;
    const processed = await processVideo("dQw4w9WgXcQ", "en", {
      cacheDir: dir,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async () => {
          uploads += 1;
        },
      },
      downloadCaptions: async () => `1
00:00:00,000 --> 00:00:01,000
Source only.
`,
      runAgent: async () => {
        throw new Error("Codex timed out after 120 seconds");
      },
    });

    expect(processed.mode).toBe("sourceFallback");
    expect(uploads).toBe(0);
  });
});
