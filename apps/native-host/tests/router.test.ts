import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { writeCachedResult } from "../src/cache.js";
import { handleRequest } from "../src/index.js";

describe("handleRequest", () => {
  it("returns status", async () => {
    await expect(handleRequest({ id: "1", type: "getStatus" })).resolves.toMatchObject({
      id: "1",
      ok: true,
      type: "status",
      installed: true,
    });
  });

  it("writes structured request lifecycle logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-logs-"));
    const previousLogFile = process.env.FF_LOG_FILE;
    process.env.FF_LOG_FILE = join(dir, "native-host.log");

    try {
      await expect(handleRequest({ id: "log1", type: "getStatus" })).resolves.toMatchObject({
        id: "log1",
        ok: true,
        type: "status",
      });
      const events = (await readFile(process.env.FF_LOG_FILE, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string; requestId: string });
      expect(events).toEqual([
        expect.objectContaining({ event: "request.started", requestId: "log1" }),
        expect.objectContaining({ event: "request.completed", requestId: "log1" }),
      ]);
    } finally {
      if (previousLogFile === undefined) {
        delete process.env.FF_LOG_FILE;
      } else {
        process.env.FF_LOG_FILE = previousLogFile;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns native host health", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-health-"));
    const previousYtDlpPath = process.env.FF_YTDLP_PATH;
    const previousCodexPath = process.env.FF_CODEX_PATH;
    const previousClaudePath = process.env.FF_CLAUDE_PATH;
    const ytDlpPath = join(dir, "yt-dlp");
    const codexPath = join(dir, "codex");
    await writeFile(ytDlpPath, "#!/bin/sh\n", "utf8");
    await writeFile(codexPath, "#!/bin/sh\n", "utf8");
    await chmod(ytDlpPath, 0o755);
    await chmod(codexPath, 0o755);
    process.env.FF_YTDLP_PATH = ytDlpPath;
    process.env.FF_CODEX_PATH = codexPath;
    process.env.FF_CLAUDE_PATH = join(dir, "missing-claude");

    try {
      await expect(handleRequest({ id: "health1", type: "healthCheck" })).resolves.toMatchObject({
        id: "health1",
        ok: true,
        type: "health",
        health: {
          agent: "codex",
          ytDlpPath,
          codexPath,
          checks: {
            ytDlp: true,
            codex: true,
            claude: false,
          },
        },
      });
    } finally {
      if (previousYtDlpPath === undefined) {
        delete process.env.FF_YTDLP_PATH;
      } else {
        process.env.FF_YTDLP_PATH = previousYtDlpPath;
      }
      if (previousCodexPath === undefined) {
        delete process.env.FF_CODEX_PATH;
      } else {
        process.env.FF_CODEX_PATH = previousCodexPath;
      }
      if (previousClaudePath === undefined) {
        delete process.env.FF_CLAUDE_PATH;
      } else {
        process.env.FF_CLAUDE_PATH = previousClaudePath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid input", async () => {
    await expect(handleRequest({ id: "1", type: "shell" })).resolves.toEqual({
      id: "unknown",
      ok: false,
      type: "error",
      code: "BAD_REQUEST",
      message: "Unsupported host request type",
    });
  });

  it("returns request-scoped cache errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-cache-"));
    const previousCacheDir = process.env.FF_CACHE_DIR;
    process.env.FF_CACHE_DIR = dir;

    try {
      const path = join(dir, "dQw4w9WgXcQ", "en", WORKFLOW_VERSION, "result.json");
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "{", "utf8");

      await expect(
        handleRequest({ id: "cache1", type: "getCachedVideo", videoId: "dQw4w9WgXcQ", captionLanguage: "en" }),
      ).resolves.toEqual({
        id: "cache1",
        ok: false,
        type: "error",
        code: "CACHE_ERROR",
        message: "Invalid cached subtitle result",
      });
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.FF_CACHE_DIR;
      } else {
        process.env.FF_CACHE_DIR = previousCacheDir;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads and writes personal notes through the native host", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-notes-"));
    const previousNotesFile = process.env.FF_NOTES_FILE;
    process.env.FF_NOTES_FILE = join(dir, ".fluent-frame", "notes.json");
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

    try {
      await expect(handleRequest({ id: "notes1", type: "getPersonalNotes" })).resolves.toEqual({
        id: "notes1",
        ok: true,
        type: "personalNotes",
        notes: [],
      });
      await expect(handleRequest({ id: "notes2", type: "savePersonalNotes", notes: [note] })).resolves.toEqual({
        id: "notes2",
        ok: true,
        type: "personalNotesSaved",
      });
      await expect(handleRequest({ id: "notes3", type: "getPersonalNotes" })).resolves.toEqual({
        id: "notes3",
        ok: true,
        type: "personalNotes",
        notes: [note],
      });
    } finally {
      if (previousNotesFile === undefined) {
        delete process.env.FF_NOTES_FILE;
      } else {
        process.env.FF_NOTES_FILE = previousNotesFile;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handles queue requests through the native host", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-queue-"));
    const previousCacheDir = process.env.FF_CACHE_DIR;
    const previousQueueFile = process.env.FF_QUEUE_FILE;
    const previousYtDlpPath = process.env.FF_YTDLP_PATH;
    const cacheDir = join(dir, "cache");
    const queueFile = join(dir, "queue", "jobs.json");
    const ytDlpPath = join(dir, "fake-yt-dlp.mjs");
    process.env.FF_CACHE_DIR = cacheDir;
    process.env.FF_QUEUE_FILE = queueFile;
    process.env.FF_YTDLP_PATH = ytDlpPath;
    const cachedResult: LearningSubtitleResult = {
      videoId: "dQw4w9WgXcQ",
      sourceLanguage: "en",
      workflowVersion: WORKFLOW_VERSION,
      generatedAt: "2026-07-21T00:00:00.000Z",
      subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
      phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }],
    };

    try {
      await writeFile(
        ytDlpPath,
        `#!/usr/bin/env node
console.log("Never Gonna Give You Up");
`,
        "utf8",
      );
      await chmod(ytDlpPath, 0o755);
      await writeCachedResult(cacheDir, cachedResult);
      const enqueued = await handleRequest({
        id: "queue1",
        type: "enqueueVideo",
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
      expect(enqueued).toMatchObject({
        id: "queue1",
        ok: true,
        type: "queueJob",
        message: "Already ready",
        job: { videoId: "dQw4w9WgXcQ", status: "done", title: "Never Gonna Give You Up" },
      });
      await expect(handleRequest({ id: "queue2", type: "getQueue" })).resolves.toMatchObject({
        id: "queue2",
        ok: true,
        type: "queue",
        queue: { jobs: [expect.objectContaining({ status: "done", title: "Never Gonna Give You Up" })] },
      });
      await expect(handleRequest({
        id: "queue3",
        type: "removeQueueJob",
        jobId: `dQw4w9WgXcQ:en:${WORKFLOW_VERSION}`,
      })).resolves.toEqual({
        id: "queue3",
        ok: true,
        type: "queue",
        queue: { paused: false, jobs: [] },
      });
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.FF_CACHE_DIR;
      } else {
        process.env.FF_CACHE_DIR = previousCacheDir;
      }
      if (previousQueueFile === undefined) {
        delete process.env.FF_QUEUE_FILE;
      } else {
        process.env.FF_QUEUE_FILE = previousQueueFile;
      }
      if (previousYtDlpPath === undefined) {
        delete process.env.FF_YTDLP_PATH;
      } else {
        process.env.FF_YTDLP_PATH = previousYtDlpPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns request-scoped processing errors when yt-dlp is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-process-"));
    const previousCacheDir = process.env.FF_CACHE_DIR;
    const previousYtDlpPath = process.env.FF_YTDLP_PATH;
    process.env.FF_CACHE_DIR = dir;
    const ytDlpPath = join(dir, "missing-yt-dlp");
    process.env.FF_YTDLP_PATH = ytDlpPath;

    try {
      await expect(
        handleRequest({ id: "process1", type: "processVideo", videoId: "dQw4w9WgXcQ", captionLanguage: "en" }),
      ).resolves.toMatchObject({
        id: "process1",
        ok: false,
        type: "error",
        code: "PROCESSING_ERROR",
        message: `yt-dlp not found at ${ytDlpPath}`,
      });
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.FF_CACHE_DIR;
      } else {
        process.env.FF_CACHE_DIR = previousCacheDir;
      }
      if (previousYtDlpPath === undefined) {
        delete process.env.FF_YTDLP_PATH;
      } else {
        process.env.FF_YTDLP_PATH = previousYtDlpPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns source subtitles when Codex is missing but captions download succeeds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ff-router-codex-"));
    const previousCacheDir = process.env.FF_CACHE_DIR;
    const previousYtDlpPath = process.env.FF_YTDLP_PATH;
    const previousCodexPath = process.env.FF_CODEX_PATH;
    const ytDlpPath = join(dir, "fake-yt-dlp.mjs");
    const codexPath = join(dir, "missing-codex");
    await writeFile(
      ytDlpPath,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.cwd(), "dQw4w9WgXcQ.en.srt"), "1\\n00:00:00,000 --> 00:00:01,000\\nSource subtitle.\\n");
`,
      "utf8",
    );
    await chmod(ytDlpPath, 0o755);
    process.env.FF_CACHE_DIR = dir;
    process.env.FF_YTDLP_PATH = ytDlpPath;
    process.env.FF_CODEX_PATH = codexPath;

    try {
      await expect(
        handleRequest({ id: "process2", type: "processVideo", videoId: "dQw4w9WgXcQ", captionLanguage: "en" }),
      ).resolves.toMatchObject({
        id: "process2",
        ok: true,
        type: "result",
        result: {
          subtitles: [{ id: 1, english: "Source subtitle.", chinese: "", phraseIds: [] }],
          phrases: [],
        },
      });
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.FF_CACHE_DIR;
      } else {
        process.env.FF_CACHE_DIR = previousCacheDir;
      }
      if (previousYtDlpPath === undefined) {
        delete process.env.FF_YTDLP_PATH;
      } else {
        process.env.FF_YTDLP_PATH = previousYtDlpPath;
      }
      if (previousCodexPath === undefined) {
        delete process.env.FF_CODEX_PATH;
      } else {
        process.env.FF_CODEX_PATH = previousCodexPath;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
