import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertLearningSubtitleResult, WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { hasCacheIdentity, matchesCacheIdentity } from "./cacheResult.js";
import { writeJsonFileAtomically } from "./jsonFile.js";

export const INVALID_CACHE_MESSAGE = "Invalid cached subtitle result";

export type CacheEntry =
  | { status: "hit"; result: LearningSubtitleResult }
  | { status: "miss" }
  | { status: "stale" }
  | { status: "corrupt"; message: string }
  | { status: "fatal"; error: unknown };

function resultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "result.json");
}

function assertCachedResult(value: unknown): asserts value is LearningSubtitleResult {
  assertLearningSubtitleResult(value, INVALID_CACHE_MESSAGE);
}

export async function readCachedResult(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
): Promise<LearningSubtitleResult | undefined> {
  const entry = await readCacheEntry(cacheDir, videoId, captionLanguage);
  if (entry.status === "hit") {
    return entry.result;
  }
  if (entry.status === "miss" || entry.status === "stale") {
    return undefined;
  }
  if (entry.status === "corrupt") {
    throw new Error(entry.message);
  }
  throw entry.error;
}

export async function readCacheEntry(cacheDir: string, videoId: string, captionLanguage: string): Promise<CacheEntry> {
  try {
    const content = await readFile(resultPath(cacheDir, videoId, captionLanguage), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!hasCacheIdentity(parsed)) {
      throw new Error(INVALID_CACHE_MESSAGE);
    }
    if (!matchesCacheIdentity(parsed, videoId, captionLanguage, WORKFLOW_VERSION)) {
      return { status: "stale" };
    }
    assertCachedResult(parsed);
    return { status: "hit", result: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "miss" };
    }
    if (error instanceof SyntaxError) {
      return { status: "corrupt", message: INVALID_CACHE_MESSAGE };
    }
    if (error instanceof Error && error.message === INVALID_CACHE_MESSAGE) {
      return { status: "corrupt", message: INVALID_CACHE_MESSAGE };
    }
    return { status: "fatal", error };
  }
}

export async function writeCachedResult(cacheDir: string, result: LearningSubtitleResult): Promise<void> {
  const path = resultPath(cacheDir, result.videoId, result.sourceLanguage);
  await writeJsonFileAtomically(path, result);
}

export async function clearCachedResult(cacheDir: string, videoId: string, captionLanguage: string): Promise<void> {
  await rm(join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION), { recursive: true, force: true });
}
