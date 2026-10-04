import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { assertLearningSubtitleResult, type LearningSubtitleResult } from "@fluent-frame/shared";
import { matchesCacheIdentity } from "./cacheResult.js";
import { writeJsonFileAtomically } from "./jsonFile.js";
import type { RemoteCacheProvider } from "./remoteCache.js";

export type CacheBackfillSummary = {
  scanned: number;
  uploaded: number;
  skippedExisting: number;
  skippedInvalid: number;
  failed: number;
};

export type CacheBackfillInput = {
  cacheDir: string;
  remoteCache: RemoteCacheProvider;
  maxUploads?: number;
  syncStateFile?: string;
  syncedResults?: LearningSubtitleResult[];
};

const DEFAULT_MAX_UPLOADS = 20;

type CacheBackfillSyncState = {
  version?: number;
  synced: string[];
  legacySynced?: string[];
};

type LoadedSyncState = { synced: Set<string>; legacySynced: Set<string> };

async function readDirNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function readCachedBackfillResult(path: string, videoId: string, sourceLanguage: string, workflowVersion: string): Promise<LearningSubtitleResult | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    assertLearningSubtitleResult(parsed);
    return matchesCacheIdentity(parsed, videoId, sourceLanguage, workflowVersion) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cacheKey(videoId: string, sourceLanguage: string, workflowVersion: string): string {
  return `${videoId}/${sourceLanguage}/${workflowVersion}`;
}

function syncStatePath(input: CacheBackfillInput): string {
  return input.syncStateFile ?? join(input.cacheDir, ".remote-cache-backfill.json");
}

async function readSyncState(path: string): Promise<LoadedSyncState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CacheBackfillSyncState>;
    const keys = (value: unknown) => new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : []);
    return parsed.version === 2
      ? { synced: keys(parsed.synced), legacySynced: keys(parsed.legacySynced) }
      : { synced: new Set(), legacySynced: keys(parsed.synced) };
  } catch {
    return { synced: new Set(), legacySynced: new Set() };
  }
}

async function writeSyncState(path: string, state: LoadedSyncState): Promise<void> {
  await writeJsonFileAtomically(path, {
    version: 2,
    synced: [...state.synced].sort(),
    legacySynced: [...state.legacySynced].sort(),
  });
}

export async function backfillRemoteCache(input: CacheBackfillInput): Promise<CacheBackfillSummary> {
  const maxUploads = Math.max(0, input.maxUploads ?? DEFAULT_MAX_UPLOADS);
  const statePath = syncStatePath(input);
  const state = await readSyncState(statePath);
  for (const result of input.syncedResults ?? []) {
    const key = cacheKey(result.videoId, result.sourceLanguage, result.workflowVersion);
    state.synced.add(key);
    state.legacySynced.delete(key);
  }
  if (input.syncedResults?.length) {
    await writeSyncState(statePath, state);
  }
  const summary: CacheBackfillSummary = {
    scanned: 0,
    uploaded: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    failed: 0,
  };
  let remoteAttempts = 0;

  for (const videoId of await readDirNames(input.cacheDir)) {
    for (const sourceLanguage of await readDirNames(join(input.cacheDir, videoId))) {
      if (sourceLanguage.includes(".stale-")) {
        continue;
      }
      for (const workflowVersion of await readDirNames(join(input.cacheDir, videoId, sourceLanguage))) {
        if (workflowVersion.includes(".stale-")) {
          continue;
        }
        const key = cacheKey(videoId, sourceLanguage, workflowVersion);
        if (state.synced.has(key)) {
          continue;
        }
        const result = await readCachedBackfillResult(
          join(input.cacheDir, videoId, sourceLanguage, workflowVersion, "result.json"),
          videoId,
          sourceLanguage,
          workflowVersion,
        );
        if (!result) {
          summary.scanned += 1;
          summary.skippedInvalid += 1;
          continue;
        }
        if (remoteAttempts >= maxUploads) {
          return summary;
        }
        remoteAttempts += 1;
        summary.scanned += 1;
        try {
          if (state.legacySynced.has(key)) {
            const remoteResult = await input.remoteCache.readResult(videoId, sourceLanguage, workflowVersion);
            if (remoteResult) {
              state.legacySynced.delete(key);
              state.synced.add(key);
              await writeSyncState(statePath, state);
              summary.skippedExisting += 1;
              continue;
            }
          }
          if (await input.remoteCache.writeResult(result) === false) {
            summary.failed += 1;
            continue;
          }
          state.legacySynced.delete(key);
          state.synced.add(key);
          await writeSyncState(statePath, state);
          summary.uploaded += 1;
        } catch {
          summary.failed += 1;
        }
      }
    }
  }

  return summary;
}
