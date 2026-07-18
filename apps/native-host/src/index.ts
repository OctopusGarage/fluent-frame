#!/usr/bin/env node
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseHostRequest, WORKFLOW_VERSION, type HostHealth, type HostResponse } from "@fluent-frame/shared";
import { clearCachedResult, readCachedResult } from "./cache.js";
import { loadHostConfig, type HostConfig } from "./config.js";
import { readNativeMessage, writeNativeMessage } from "./nativeMessaging.js";
import { readPersonalNotes, writePersonalNotes } from "./notes.js";

const execFileAsync = promisify(execFile);

function cacheErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "CACHE_ERROR",
    message: error instanceof Error ? error.message : "Cache operation failed",
  };
}

async function executableExists(path: string): Promise<boolean> {
  if (!path.includes("/")) {
    try {
      await execFileAsync("/usr/bin/env", ["sh", "-lc", `command -v ${path}`]);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function buildHealth(config: HostConfig): Promise<HostHealth> {
  const [ytDlp, codex, claude] = await Promise.all([
    executableExists(config.ytDlpPath),
    executableExists(config.codexPath),
    executableExists(config.claudePath),
  ]);
  return {
    version: "0.1.0",
    workflowVersion: WORKFLOW_VERSION,
    agent: config.agent,
    cacheDir: config.cacheDir,
    notesFile: config.notesFile,
    ytDlpPath: config.ytDlpPath,
    codexPath: config.codexPath,
    claudePath: config.claudePath,
    checks: {
      ytDlp,
      codex,
      claude,
    },
  };
}

export async function handleRequest(input: unknown, emit?: (response: HostResponse) => void): Promise<HostResponse> {
  let request;
  try {
    request = parseHostRequest(input);
  } catch (error) {
    return {
      id: "unknown",
      ok: false,
      type: "error",
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Invalid request",
    };
  }

  if (request.type === "getStatus") {
    return { id: request.id, ok: true, type: "status", installed: true, workflowVersion: WORKFLOW_VERSION };
  }

  const config = loadHostConfig();

  if (request.type === "healthCheck") {
    return { id: request.id, ok: true, type: "health", health: await buildHealth(config) };
  }

  if (request.type === "getCachedVideo") {
    try {
      const cached = await readCachedResult(config.cacheDir, request.videoId, request.captionLanguage);
      return cached
        ? { id: request.id, ok: true, type: "result", result: cached }
        : { id: request.id, ok: true, type: "cacheMiss" };
    } catch (error) {
      return cacheErrorResponse(request.id, error);
    }
  }

  if (request.type === "getPersonalNotes") {
    try {
      const notes = await readPersonalNotes(config.notesFile);
      return { id: request.id, ok: true, type: "personalNotes", notes };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        type: "error",
        code: "NOTES_ERROR",
        message: error instanceof Error ? error.message : "Notes operation failed",
      };
    }
  }

  if (request.type === "savePersonalNotes") {
    try {
      await writePersonalNotes(config.notesFile, request.notes);
      return { id: request.id, ok: true, type: "personalNotesSaved" };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        type: "error",
        code: "NOTES_ERROR",
        message: error instanceof Error ? error.message : "Notes operation failed",
      };
    }
  }

  if (request.type === "clearVideoCache") {
    try {
      await clearCachedResult(config.cacheDir, request.videoId, request.captionLanguage);
      return { id: request.id, ok: true, type: "cacheCleared" };
    } catch (error) {
      return cacheErrorResponse(request.id, error);
    }
  }

  if (request.type === "processVideo") {
    try {
      if (request.stream) {
        emit?.({
          id: request.id,
          ok: true,
          type: "progress",
          progress: { stage: "download", message: "Downloading YouTube captions" },
        });
      }
      const { createConfiguredRunner } = await import("./agentRunner.js");
      const { downloadCaptions } = await import("./captionDownloader.js");
      const { processVideo } = await import("./processor.js");
      const runAgent = await createConfiguredRunner(config.agent, {
        codexPath: config.codexPath,
        claudePath: config.claudePath,
      });
      const output = await processVideo(request.videoId, request.captionLanguage, {
        cacheDir: config.cacheDir,
        downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
        runAgent,
        ...(request.stream
          ? {
              onPartialResult(result, progress) {
                emit?.({
                  id: request.id,
                  ok: true,
                  type: "progress",
                  progress: {
                    stage: "agent",
                    message: `Generated batch ${progress.completedBatches} of ${progress.totalBatches}`,
                    completedBatches: progress.completedBatches,
                    totalBatches: progress.totalBatches,
                  },
                });
                emit?.({
                  id: request.id,
                  ok: true,
                  type: "partialResult",
                  result,
                  completedBatches: progress.completedBatches,
                  totalBatches: progress.totalBatches,
                });
              },
            }
          : {}),
      });
      if (request.stream) {
        emit?.({
          id: request.id,
          ok: true,
          type: "progress",
          progress: { stage: "done", message: "Finalizing learning subtitles" },
        });
      }
      return { id: request.id, ok: true, type: "result", result: output.result };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        type: "error",
        code: "PROCESSING_ERROR",
        message: error instanceof Error ? error.message : "Video processing failed",
      };
    }
  }

  return {
    id: request.id,
    ok: false,
    type: "error",
    code: "PROCESSOR_UNAVAILABLE",
    message: `${request.type} requires the processing pipeline`,
  };
}

async function main(): Promise<void> {
  const input = await readNativeMessage();
  writeNativeMessage(await handleRequest(input, (response) => {
    writeNativeMessage(response);
  }));
}

function isEntrypoint(): boolean {
  const invokedPath = process.argv[1];
  return invokedPath ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(invokedPath)) : false;
}

if (isEntrypoint()) {
  main().catch((error) => {
    writeNativeMessage({
      id: "unknown",
      ok: false,
      type: "error",
      code: "HOST_CRASH",
      message: error instanceof Error ? error.message : "Native host crashed",
    });
  });
}
