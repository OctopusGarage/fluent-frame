import { describe, expect, it } from "vitest";
import {
  parseHostRequest,
  parseHostResponse,
  parsePersonalNotes,
  parseCaptionLanguage,
  parseQueueJob,
  parseQueueJobId,
  parseQueueState,
  parseRequestId,
  parseYoutubeVideoId,
  WORKFLOW_VERSION,
} from "../src/protocol.js";

const validLearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: WORKFLOW_VERSION,
  generatedAt: "2026-07-21T00:00:00.000Z",
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{
    id: "p1",
    cueId: 1,
    phrase: "nice pass",
    meaningZh: "传得漂亮",
    explanationEn: "A good pass.",
    difficulty: "useful",
  }],
};

describe("parseYoutubeVideoId", () => {
  it("accepts normal YouTube IDs", () => {
    expect(parseYoutubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects unsafe IDs", () => {
    expect(() => parseYoutubeVideoId("../bad")).toThrow("Invalid YouTube video ID");
  });
});

describe("parseHostRequest", () => {
  it("parses a health check request", () => {
    expect(parseHostRequest({ id: "health1", type: "healthCheck" })).toEqual({
      id: "health1",
      type: "healthCheck",
    });
  });

  it("parses a processVideo request", () => {
    expect(
      parseHostRequest({
        id: "1",
        type: "processVideo",
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
      }),
    ).toEqual({
      id: "1",
      type: "processVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
    });
  });

  it("parses cache requests with validated video and language fields", () => {
    expect(parseHostRequest({
      id: "cache1",
      type: "getCachedVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en-US",
    })).toEqual({
      id: "cache1",
      type: "getCachedVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en-US",
    });

    expect(parseHostRequest({
      id: "cache2",
      type: "clearVideoCache",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "eng",
    })).toEqual({
      id: "cache2",
      type: "clearVideoCache",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "eng",
    });
  });

  it("parses personal notes requests", () => {
    const note = {
      id: "dQw4w9WgXcQ:1:p1",
      videoId: "dQw4w9WgXcQ",
      cueId: 1,
      startMs: 1200,
      sentenceEnglish: "Nice pass.",
      sentenceChinese: "传得漂亮。",
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
      savedAt: "2026-07-19T00:00:00.000Z",
    };

    expect(parseHostRequest({ id: "notes1", type: "getPersonalNotes" })).toEqual({
      id: "notes1",
      type: "getPersonalNotes",
    });
    expect(parseHostRequest({ id: "notes2", type: "savePersonalNotes", notes: [note] })).toEqual({
      id: "notes2",
      type: "savePersonalNotes",
      notes: [note],
    });
  });

  it("parses queue requests", () => {
    expect(parseHostRequest({
      id: "queue1",
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
    })).toEqual({
      id: "queue1",
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
    });
    expect(parseHostRequest({ id: "queue2", type: "getQueue" })).toEqual({ id: "queue2", type: "getQueue" });
    expect(parseHostRequest({
      id: "queue3",
      type: "removeQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    })).toEqual({
      id: "queue3",
      type: "removeQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    });
    expect(parseHostRequest({
      id: "queue4",
      type: "retryQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    })).toEqual({
      id: "queue4",
      type: "retryQueueJob",
      jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    });
  });

  it("trims optional queue metadata and rejects unusable values", () => {
    expect(parseHostRequest({
      id: "queue5",
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
      title: "  Never Gonna Give You Up  ",
    })).toEqual({
      id: "queue5",
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
    });

    expect(() => parseHostRequest({
      id: "queue6",
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      title: " ",
    })).toThrow("Invalid queue title");
  });

  it("rejects unknown message types", () => {
    expect(() => parseHostRequest({ id: "1", type: "shell", command: "rm -rf /" })).toThrow(
      "Unsupported host request type",
    );
  });
});

describe("parsePersonalNotes", () => {
  it("accepts valid notes", () => {
    expect(
      parsePersonalNotes([
        {
          id: "dQw4w9WgXcQ:1:p1",
          videoId: "dQw4w9WgXcQ",
          cueId: 1,
          startMs: 1200,
          sentenceEnglish: "Nice pass.",
          sentenceChinese: "传得漂亮。",
          phrase: "nice pass",
          meaningZh: "传得漂亮",
          explanationEn: "A good pass.",
          usageNotes: [
            {
              term: "sign",
              question: "Why use sign here?",
              explanation: "It means to close or finish.",
            },
          ],
          savedAt: "2026-07-19T00:00:00.000Z",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects invalid note arrays", () => {
    expect(() => parsePersonalNotes([{ id: "../bad" }])).toThrow("Invalid personal notes");
    expect(() => parsePersonalNotes([
      {
        id: "dQw4w9WgXcQ:1:p1",
        videoId: "dQw4w9WgXcQ",
        cueId: 1,
        startMs: 1200,
        sentenceEnglish: "Nice pass.",
        sentenceChinese: "传得漂亮。",
        phrase: "nice pass",
        meaningZh: "传得漂亮",
        explanationEn: "A good pass.",
        usageNotes: [{ term: "sign" }],
        savedAt: "2026-07-19T00:00:00.000Z",
      },
    ])).toThrow("Invalid personal notes");
  });
});

describe("parseRequestId", () => {
  it("accepts safe request ID tokens", () => {
    expect(parseRequestId("1")).toBe("1");
    expect(parseRequestId("abc-123")).toBe("abc-123");
    expect(parseRequestId("1760000000000-550e8400-e29b-41d4-a716-446655440000")).toBe(
      "1760000000000-550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rejects spaces, newlines, and control characters", () => {
    expect(() => parseRequestId("abc 123")).toThrow("Invalid request ID");
    expect(() => parseRequestId("abc\n123")).toThrow("Invalid request ID");
    expect(() => parseRequestId("abc\u0000123")).toThrow("Invalid request ID");
  });
});

describe("parseCaptionLanguage", () => {
  it("accepts lower-case base languages with optional regional suffixes", () => {
    expect(parseCaptionLanguage("en")).toBe("en");
    expect(parseCaptionLanguage("eng")).toBe("eng");
    expect(parseCaptionLanguage("pt-BR")).toBe("pt-BR");
  });

  it("rejects unsupported language tokens", () => {
    expect(() => parseCaptionLanguage("EN")).toThrow("Invalid caption language");
    expect(() => parseCaptionLanguage("../en")).toThrow("Invalid caption language");
    expect(() => parseCaptionLanguage("english")).toThrow("Invalid caption language");
  });
});

describe("parseQueueJobId", () => {
  it("accepts deterministic queue job IDs", () => {
    expect(parseQueueJobId(`dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`)).toBe(`dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`);
  });

  it("rejects path traversal", () => {
    expect(() => parseQueueJobId("../bad")).toThrow("Invalid queue job ID");
  });
});

describe("parseQueueJob", () => {
  const job = {
    id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    status: "running",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:01:00.000Z",
    startedAt: "2026-07-21T00:00:30.000Z",
    finishedAt: "2026-07-21T00:02:00.000Z",
    completedBatches: 1,
    totalBatches: 2,
    error: "retrying",
  };

  it("preserves optional queue progress metadata from the native host", () => {
    expect(parseQueueJob(job)).toEqual(job);
  });

  it("rejects invalid queue status and batch counts", () => {
    expect(() => parseQueueJob({ ...job, status: "paused" })).toThrow("Invalid queue job");
    expect(() => parseQueueJob({ ...job, completedBatches: -1 })).toThrow("Invalid queue job");
    expect(() => parseQueueJob({ ...job, totalBatches: 1.5 })).toThrow("Invalid queue job");
  });

  it("rejects invalid running job IDs before exposing queue state", () => {
    expect(() => parseQueueState({
      paused: false,
      runningJobId: "../bad",
      jobs: [job],
    })).toThrow("Invalid queue state");
  });
});

describe("parseHostResponse", () => {
  it("accepts status and error responses from the native host", () => {
    expect(parseHostResponse("status1", {
      id: "status1",
      ok: true,
      type: "status",
      installed: true,
      workflowVersion: WORKFLOW_VERSION,
    })).toEqual({
      id: "status1",
      ok: true,
      type: "status",
      installed: true,
      workflowVersion: WORKFLOW_VERSION,
    });

    expect(parseHostResponse("error1", {
      id: "error1",
      ok: false,
      type: "error",
      code: "YTDLP_MISSING",
      message: "yt-dlp is not available",
    })).toEqual({
      id: "error1",
      ok: false,
      type: "error",
      code: "YTDLP_MISSING",
      message: "yt-dlp is not available",
    });
  });

  it("defaults missing or disabled remote cache health to disabled", () => {
    expect(parseHostResponse("health-disabled", {
      id: "health-disabled",
      ok: true,
      type: "health",
      health: {
        version: "0.1.0",
        workflowVersion: WORKFLOW_VERSION,
        agent: "claude",
        cacheDir: "/tmp/cache",
        notesFile: "/tmp/notes.json",
        ytDlpPath: "yt-dlp",
        checks: { ytDlp: true, codex: false, claude: true },
      },
    })).toMatchObject({ health: { remoteCache: { enabled: false } } });

    expect(parseHostResponse("health-off", {
      id: "health-off",
      ok: true,
      type: "health",
      health: {
        version: "0.1.0",
        workflowVersion: WORKFLOW_VERSION,
        agent: "codex",
        cacheDir: "/tmp/cache",
        notesFile: "/tmp/notes.json",
        remoteCache: { enabled: false, provider: "github" },
        ytDlpPath: "yt-dlp",
        checks: { ytDlp: true, codex: true, claude: false },
      },
    })).toMatchObject({ health: { remoteCache: { enabled: false } } });
  });

  it("accepts health responses with GitHub remote cache status", () => {
    expect(parseHostResponse("health1", {
      id: "health1",
      ok: true,
      type: "health",
      health: {
        version: "0.1.0",
        workflowVersion: WORKFLOW_VERSION,
        agent: "codex",
        cacheDir: "/tmp/cache",
        notesFile: "/tmp/notes.json",
        remoteCache: {
          enabled: true,
          provider: "github",
          owner: "octo",
          repo: "cache",
          branch: "main",
          basePath: "data/youtube",
          writeEnabled: false,
          tokenConfigured: false,
        },
        ytDlpPath: "yt-dlp",
        checks: { ytDlp: true, codex: true, claude: false },
      },
    })).toMatchObject({
      type: "health",
      health: {
        remoteCache: {
          enabled: true,
          provider: "github",
          owner: "octo",
          repo: "cache",
        },
      },
    });
  });

  it("accepts streaming progress and partial result responses", () => {
    expect(parseHostResponse("progress1", {
      id: "progress1",
      ok: true,
      type: "progress",
      progress: {
        stage: "agent",
        message: "Generated batch 1 of 2",
        completedBatches: 1,
        totalBatches: 2,
      },
    })).toEqual({
      id: "progress1",
      ok: true,
      type: "progress",
      progress: {
        stage: "agent",
        message: "Generated batch 1 of 2",
        completedBatches: 1,
        totalBatches: 2,
      },
    });

    expect(parseHostResponse("partial1", {
      id: "partial1",
      ok: true,
      type: "partialResult",
      result: validLearningSubtitleResult,
      completedBatches: 1,
      totalBatches: 2,
    })).toEqual({
      id: "partial1",
      ok: true,
      type: "partialResult",
      result: validLearningSubtitleResult,
      completedBatches: 1,
      totalBatches: 2,
    });
  });

  it("accepts personal notes and cache acknowledgement responses", () => {
    const note = {
      id: "dQw4w9WgXcQ:1:p1",
      videoId: "dQw4w9WgXcQ",
      cueId: 1,
      startMs: 1200,
      sentenceEnglish: "Nice pass.",
      sentenceChinese: "传得漂亮。",
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
      savedAt: "2026-07-19T00:00:00.000Z",
    };

    expect(parseHostResponse("notes1", {
      id: "notes1",
      ok: true,
      type: "personalNotes",
      notes: [note],
    })).toEqual({ id: "notes1", ok: true, type: "personalNotes", notes: [note] });

    expect(parseHostResponse("saved1", { id: "saved1", ok: true, type: "personalNotesSaved" })).toEqual({
      id: "saved1",
      ok: true,
      type: "personalNotesSaved",
    });
    expect(parseHostResponse("miss1", { id: "miss1", ok: true, type: "cacheMiss" })).toEqual({
      id: "miss1",
      ok: true,
      type: "cacheMiss",
    });
    expect(parseHostResponse("cleared1", { id: "cleared1", ok: true, type: "cacheCleared" })).toEqual({
      id: "cleared1",
      ok: true,
      type: "cacheCleared",
    });
  });

  it("rejects responses with mismatched IDs or malformed health payloads", () => {
    expect(() => parseHostResponse("expected", {
      id: "actual",
      ok: true,
      type: "cacheMiss",
    })).toThrow("Invalid native host response");

    expect(() => parseHostResponse("health-bad", {
      id: "health-bad",
      ok: true,
      type: "health",
      health: {
        version: "0.1.0",
        workflowVersion: WORKFLOW_VERSION,
        agent: "codex",
        cacheDir: "/tmp/cache",
        notesFile: "/tmp/notes.json",
        remoteCache: { enabled: true, provider: "github" },
        ytDlpPath: "yt-dlp",
        checks: { ytDlp: true, codex: true, claude: false },
      },
    })).toThrow("Invalid native host response");
  });

  it("accepts queue responses", () => {
    const job = {
      id: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
      workflowVersion: WORKFLOW_VERSION,
      status: "queued",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    };
    expect(parseHostResponse("queue1", {
      id: "queue1",
      ok: true,
      type: "queueJob",
      message: "Queued",
      job,
    })).toEqual({
      id: "queue1",
      ok: true,
      type: "queueJob",
      message: "Queued",
      job,
    });
    expect(parseHostResponse("queue2", {
      id: "queue2",
      ok: true,
      type: "queue",
      queue: { paused: false, runningJobId: job.id, jobs: [job] },
    })).toEqual({
      id: "queue2",
      ok: true,
      type: "queue",
      queue: { paused: false, runningJobId: job.id, jobs: [job] },
    });
  });

  it("rejects progress responses with invalid batch counters", () => {
    expect(() => parseHostResponse("progress1", {
      id: "progress1",
      ok: true,
      type: "progress",
      progress: {
        stage: "agent",
        message: "Generated batch -1 of 2",
        completedBatches: -1,
        totalBatches: 2,
      },
    })).toThrow("Invalid native host response");

    expect(() => parseHostResponse("progress2", {
      id: "progress2",
      ok: true,
      type: "progress",
      progress: {
        stage: "agent",
        message: "Generated batch 1 of 1.5",
        completedBatches: 1,
        totalBatches: 1.5,
      },
    })).toThrow("Invalid native host response");
  });

  it("rejects partial results with invalid batch counters", () => {
    expect(() => parseHostResponse("partial1", {
      id: "partial1",
      ok: true,
      type: "partialResult",
      result: validLearningSubtitleResult,
      completedBatches: -1,
      totalBatches: 2,
    })).toThrow("Invalid native host response");

    expect(() => parseHostResponse("partial2", {
      id: "partial2",
      ok: true,
      type: "partialResult",
      result: validLearningSubtitleResult,
      completedBatches: 1,
      totalBatches: 1.5,
    })).toThrow("Invalid native host response");
  });

  it("rejects learning subtitle results with invalid nested cue data", () => {
    expect(() => parseHostResponse("response1", {
      id: "response1",
      ok: true,
      type: "result",
      result: {
        videoId: "dQw4w9WgXcQ",
        sourceLanguage: "en",
        workflowVersion: "test",
        generatedAt: "2026-07-21T00:00:00.000Z",
        subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["missing"] }],
        phrases: [],
      },
    })).toThrow("Invalid native host response");
  });
});
