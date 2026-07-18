#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHostRequest, WORKFLOW_VERSION, type HostResponse } from "@fluent-frame/shared";
import { clearCachedResult, readCachedResult } from "./cache.js";
import { loadHostConfig } from "./config.js";
import { readNativeMessage, writeNativeMessage } from "./nativeMessaging.js";
import { readPersonalNotes, writePersonalNotes } from "./notes.js";

function cacheErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "CACHE_ERROR",
    message: error instanceof Error ? error.message : "Cache operation failed",
  };
}

export async function handleRequest(input: unknown): Promise<HostResponse> {
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
      const { createCodexRunner } = await import("./agentRunner.js");
      const { downloadCaptions } = await import("./captionDownloader.js");
      const { processVideo } = await import("./processor.js");
      const runAgent = await createCodexRunner(config.codexPath);
      const output = await processVideo(request.videoId, request.captionLanguage, {
        cacheDir: config.cacheDir,
        downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
        runAgent,
      });
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
  writeNativeMessage(await handleRequest(input));
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
