import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKFLOW_VERSION } from "@fluent-frame/shared";
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
