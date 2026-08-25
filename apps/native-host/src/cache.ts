import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assertAgentOutput,
  assertLearningSubtitleResult,
  WORKFLOW_VERSION,
  type AgentOutput,
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

function resultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "result.json");
}

function partialResultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "partial-result.json");
}

function assertCachedResult(value: unknown): asserts value is LearningSubtitleResult {
  assertLearningSubtitleResult(value, INVALID_CACHE_MESSAGE);
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
