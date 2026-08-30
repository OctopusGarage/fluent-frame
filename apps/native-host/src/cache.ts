import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  assertAgentOutput,
  assertLearningSubtitleResult,
  WORKFLOW_VERSION,
  type AgentOutput,
  type CachedVideoSummary,
  type LearningSubtitleResult,
} from "@fluent-frame/shared";
import type { AgentBatchProgress } from "./agentTypes.js";
import { hasCacheIdentity, matchesCacheIdentity } from "./cacheResult.js";
import { writeJsonFileAtomically } from "./jsonFile.js";

export const INVALID_CACHE_MESSAGE = "Invalid cached subtitle result";

export type CacheEntry =
  | { status: "hit"; result: LearningSubtitleResult }
  | { status: "miss" }
  | { status: "stale" }
  | { status: "corrupt"; message: string }
  | { status: "fatal"; error: unknown };

export type CachedPartialResult = AgentBatchProgress & {
  result: LearningSubtitleResult;
  updatedAt: string;
};

type CacheMetadata = {
  lastWatchedAt?: string;
  title?: string;
};

function resultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "result.json");
}

function partialResultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "partial-result.json");
}

function metadataPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "metadata.json");
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function isSafeCaptionLanguage(value: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(value);
}

function assertCachedResult(value: unknown): asserts value is LearningSubtitleResult {
  assertLearningSubtitleResult(value, INVALID_CACHE_MESSAGE);
}

function validIsoTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function validTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && value.trim().length <= 500 ? value.trim() : undefined;
}

async function readCacheMetadata(cacheDir: string, videoId: string, captionLanguage: string): Promise<CacheMetadata> {
  try {
    const content = await readFile(metadataPath(cacheDir, videoId, captionLanguage), "utf8");
    const parsed = JSON.parse(content) as { lastWatchedAt?: unknown; title?: unknown };
    const lastWatchedAt = validIsoTimestamp(parsed.lastWatchedAt);
    const title = validTitle(parsed.title);
    return {
      ...(lastWatchedAt ? { lastWatchedAt } : {}),
      ...(title ? { title } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

async function writeCacheMetadata(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
  metadata: CacheMetadata,
): Promise<void> {
  const current = await readCacheMetadata(cacheDir, videoId, captionLanguage);
  await writeJsonFileAtomically(metadataPath(cacheDir, videoId, captionLanguage), { ...current, ...metadata });
}

function newestTimestamp(...values: Array<string | undefined>): string {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return timestamps[0] ?? new Date(0).toISOString();
}

function assertCachedPartialResult(
  value: unknown,
  videoId: string,
  captionLanguage: string,
): asserts value is CachedPartialResult {
  if (!value || typeof value !== "object") {
    throw new Error(INVALID_CACHE_MESSAGE);
  }
  const candidate = value as {
    result?: unknown;
    output?: unknown;
    completedBatches?: unknown;
    totalBatches?: unknown;
    updatedAt?: unknown;
  };
  if (
    typeof candidate.completedBatches !== "number"
    || typeof candidate.totalBatches !== "number"
    || !Number.isInteger(candidate.completedBatches)
    || !Number.isInteger(candidate.totalBatches)
    || candidate.completedBatches < 1
    || candidate.completedBatches > candidate.totalBatches
    || typeof candidate.updatedAt !== "string"
  ) {
    throw new Error(INVALID_CACHE_MESSAGE);
  }
  assertAgentOutput(candidate.output, INVALID_CACHE_MESSAGE);
  assertLearningSubtitleResult(candidate.result, INVALID_CACHE_MESSAGE);
  if (!matchesCacheIdentity(candidate.result, videoId, captionLanguage, WORKFLOW_VERSION)) {
    throw new Error(INVALID_CACHE_MESSAGE);
  }
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

export async function markCachedVideoWatched(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
  watchedAt = new Date().toISOString(),
  title?: string,
): Promise<void> {
  const normalizedTitle = validTitle(title);
  await writeCacheMetadata(cacheDir, videoId, captionLanguage, {
    lastWatchedAt: watchedAt,
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
  });
}

export async function writeCachedVideoTitle(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
  title: string | undefined,
): Promise<void> {
  const normalizedTitle = validTitle(title);
  if (!normalizedTitle) {
    return;
  }
  await writeCacheMetadata(cacheDir, videoId, captionLanguage, { title: normalizedTitle });
}

export async function listCachedVideoSummaries(cacheDir: string): Promise<CachedVideoSummary[]> {
  let videoDirs;
  try {
    videoDirs = await readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const summaries: CachedVideoSummary[] = [];
  for (const videoDir of videoDirs) {
    if (!videoDir.isDirectory() || !isSafePathSegment(videoDir.name)) {
      continue;
    }
    const videoId = videoDir.name;
    let languageDirs;
    try {
      languageDirs = await readdir(join(cacheDir, videoId), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const languageDir of languageDirs) {
      if (!languageDir.isDirectory() || !isSafeCaptionLanguage(languageDir.name)) {
        continue;
      }
      const captionLanguage = languageDir.name;
      const path = resultPath(cacheDir, videoId, captionLanguage);
      try {
        const [content, resultStats, metadata] = await Promise.all([
          readFile(path, "utf8"),
          stat(path),
          readCacheMetadata(cacheDir, videoId, captionLanguage),
        ]);
        const parsed = JSON.parse(content) as unknown;
        if (!matchesCacheIdentity(parsed, videoId, captionLanguage, WORKFLOW_VERSION)) {
          continue;
        }
        assertCachedResult(parsed);
        const sortAt = metadata.lastWatchedAt ?? newestTimestamp(parsed.generatedAt, resultStats.mtime.toISOString());
        summaries.push({
          videoId,
          ...(metadata.title ? { title: metadata.title } : {}),
          captionLanguage,
          workflowVersion: parsed.workflowVersion,
          generatedAt: parsed.generatedAt,
          ...(metadata.lastWatchedAt ? { lastWatchedAt: metadata.lastWatchedAt } : {}),
          sortAt,
          subtitleCount: parsed.subtitles.length,
          phraseCount: parsed.phrases.length,
        });
      } catch {
        continue;
      }
    }
  }
  return summaries.sort((left, right) => Date.parse(right.sortAt) - Date.parse(left.sortAt));
}

export async function readCachedPartialResult(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
): Promise<CachedPartialResult | undefined> {
  try {
    const content = await readFile(partialResultPath(cacheDir, videoId, captionLanguage), "utf8");
    const parsed = JSON.parse(content) as unknown;
    assertCachedPartialResult(parsed, videoId, captionLanguage);
    return parsed;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT"
      || error instanceof SyntaxError
      || (error instanceof Error && error.message === INVALID_CACHE_MESSAGE)
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function writeCachedPartialResult(
  cacheDir: string,
  result: LearningSubtitleResult,
  progress: AgentBatchProgress,
): Promise<void> {
  const path = partialResultPath(cacheDir, result.videoId, result.sourceLanguage);
  await writeJsonFileAtomically(path, {
    result,
    output: progress.output,
    completedBatches: progress.completedBatches,
    totalBatches: progress.totalBatches,
    updatedAt: new Date().toISOString(),
  } satisfies CachedPartialResult);
}

export async function clearCachedPartialResult(cacheDir: string, videoId: string, captionLanguage: string): Promise<void> {
  await rm(partialResultPath(cacheDir, videoId, captionLanguage), { force: true });
}

export async function clearCachedResult(cacheDir: string, videoId: string, captionLanguage: string): Promise<void> {
  await rm(join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION), { recursive: true, force: true });
}
