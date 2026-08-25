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
  synced: string[];
};

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

async function readSyncState(path: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CacheBackfillSyncState>;
    return new Set(Array.isArray(parsed.synced) ? parsed.synced.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

async function writeSyncState(path: string, synced: Set<string>): Promise<void> {
  await writeJsonFileAtomically(path, { synced: [...synced].sort() });
}

export async function backfillRemoteCache(input: CacheBackfillInput): Promise<CacheBackfillSummary> {
  const maxUploads = Math.max(0, input.maxUploads ?? DEFAULT_MAX_UPLOADS);
  const statePath = syncStatePath(input);
  const synced = await readSyncState(statePath);
  for (const result of input.syncedResults ?? []) {
    synced.add(cacheKey(result.videoId, result.sourceLanguage, result.workflowVersion));
  }
  if (input.syncedResults?.length) {
    await writeSyncState(statePath, synced);
  }
  const summary: CacheBackfillSummary = {
    scanned: 0,
    uploaded: 0,
    skippedExisting: 0,
    skippedInvalid: 0,
    failed: 0,
  };

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
        if (synced.has(key)) {
          continue;
        }
        if (summary.uploaded >= maxUploads) {
          return summary;
        }
        summary.scanned += 1;
        const result = await readCachedBackfillResult(
          join(input.cacheDir, videoId, sourceLanguage, workflowVersion, "result.json"),
          videoId,
          sourceLanguage,
          workflowVersion,
        );
        if (!result) {
          summary.skippedInvalid += 1;
          continue;
        }
        try {
          await input.remoteCache.writeResult(result);
          synced.add(key);
          await writeSyncState(statePath, synced);
          summary.uploaded += 1;
        } catch {
          summary.failed += 1;
        }
      }
    }
  }

  return summary;
}
