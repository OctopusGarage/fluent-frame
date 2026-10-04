import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backfillRemoteCache } from "../src/cacheBackfill.js";
import { writeCachedResult } from "../src/cache.js";
import { writeJsonFileAtomically } from "../src/jsonFile.js";
import { createGithubRemoteCache } from "../src/remoteCache.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-cache-backfill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function result(videoId: string): LearningSubtitleResult {
  return {
    videoId,
    sourceLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    generatedAt: "2026-07-21T00:00:00.000Z",
    subtitles: [
      {
        id: 1,
        startMs: 0,
        endMs: 1000,
        english: `Sentence ${videoId}.`,
        chinese: "句子。",
        phraseIds: ["p1"],
      },
    ],
    phrases: [
      {
        id: "p1",
        cueId: 1,
        phrase: "sentence",
        meaningZh: "句子",
        explanationEn: "A generated sentence.",
        difficulty: "basic",
      },
    ],
  };
}

describe("backfillRemoteCache", () => {
  it("retries a legacy synced mark when the remote result is missing", async () => {
    const cached = result("legacyFalse1");
    await writeCachedResult(dir, cached);
    const statePath = join(dir, ".remote-cache-backfill.json");
    await writeJsonFileAtomically(statePath, { synced: [`${cached.videoId}/en/${WORKFLOW_VERSION}`] });
    const requests: string[] = [];
    const remoteCache = createGithubRemoteCache({
      config: {
        enabled: true, provider: "github", owner: "octo", repo: "cache", branch: "main",
        basePath: "data/youtube", writeEnabled: true, token: "token",
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.method);
        return request.method === "GET" ? new Response("", { status: 404 }) : new Response("", { status: 200 });
      },
    });

    expect((await backfillRemoteCache({ cacheDir: dir, remoteCache })).uploaded).toBe(1);
    expect(requests).toEqual(["GET", "GET", "PUT"]);
    await backfillRemoteCache({ cacheDir: dir, remoteCache });
    expect(requests).toEqual(["GET", "GET", "PUT"]);
  });

  it("verifies a legacy synced mark without uploading an existing remote result", async () => {
    const cached = result("legacyTrue1");
    await writeCachedResult(dir, cached);
    await writeJsonFileAtomically(join(dir, ".remote-cache-backfill.json"), { synced: [`${cached.videoId}/en/${WORKFLOW_VERSION}`] });
    let reads = 0;
    let writes = 0;
    const remoteCache = {
      readResult: async () => { reads += 1; return cached; },
      writeResult: async () => { writes += 1; },
    };

    expect((await backfillRemoteCache({ cacheDir: dir, remoteCache })).uploaded).toBe(0);
    await backfillRemoteCache({ cacheDir: dir, remoteCache });
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  });

  it("leaves a legacy mark pending after a transient remote read error", async () => {
    const cached = result("legacyError1");
    await writeCachedResult(dir, cached);
    const statePath = join(dir, ".remote-cache-backfill.json");
    await writeJsonFileAtomically(statePath, { synced: [`${cached.videoId}/en/${WORKFLOW_VERSION}`] });
    let reads = 0;
    let writes = 0;
    const remoteCache = {
      readResult: async () => { reads += 1; if (reads === 1) throw new Error("GitHub 503"); return undefined; },
      writeResult: async () => { writes += 1; },
    };

    expect((await backfillRemoteCache({ cacheDir: dir, remoteCache })).failed).toBe(1);
    expect(writes).toBe(0);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({ synced: [`${cached.videoId}/en/${WORKFLOW_VERSION}`] });
    expect((await backfillRemoteCache({ cacheDir: dir, remoteCache })).uploaded).toBe(1);
    expect(reads).toBe(2);
    expect(writes).toBe(1);
  });

  it("bounds legacy verification attempts even when remote reads fail", async () => {
    const first = result("legacyError1");
    const second = result("legacyError2");
    await writeCachedResult(dir, first);
    await writeCachedResult(dir, second);
    await writeJsonFileAtomically(join(dir, ".remote-cache-backfill.json"), {
      synced: [first, second].map((value) => `${value.videoId}/en/${WORKFLOW_VERSION}`),
    });
    let reads = 0;
    const summary = await backfillRemoteCache({
      cacheDir: dir,
      maxUploads: 1,
      remoteCache: {
        readResult: async () => { reads += 1; throw new Error("GitHub 503"); },
        writeResult: async () => { throw new Error("unexpected PUT"); },
      },
    });
    expect(summary).toMatchObject({ scanned: 1, failed: 1, uploaded: 0 });
    expect(reads).toBe(1);
  });

  it("uploads local cache results and skips stale cache directories", async () => {
    const uploaded: string[] = [];
    const staleResult = result("staleVideo01");
    await writeCachedResult(dir, result("missingOne1"));
    await writeCachedResult(dir, result("missingTwo2"));
    await mkdir(join(dir, "staleVideo01", "en.stale-20260719", WORKFLOW_VERSION), { recursive: true });
    await writeJsonFileAtomically(join(dir, "staleVideo01", "en.stale-20260719", WORKFLOW_VERSION, "result.json"), staleResult);

    const summary = await backfillRemoteCache({
      cacheDir: dir,
      remoteCache: {
        readResult: async () => {
          throw new Error("backfill should not preflight remote cache entries");
        },
        writeResult: async (cachedResult) => {
          uploaded.push(cachedResult.videoId);
        },
      },
    });

    expect(summary).toEqual({ scanned: 2, uploaded: 2, skippedExisting: 0, skippedInvalid: 0, failed: 0 });
    expect(uploaded).toEqual(["missingOne1", "missingTwo2"]);
  });

  it("limits uploads per backfill run", async () => {
    const uploaded: string[] = [];
    await writeCachedResult(dir, result("missingOne1"));
    await writeCachedResult(dir, result("missingTwo2"));

    const summary = await backfillRemoteCache({
      cacheDir: dir,
      maxUploads: 1,
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async (cachedResult) => {
          uploaded.push(cachedResult.videoId);
        },
      },
    });

    expect(summary).toMatchObject({ scanned: 1, uploaded: 1 });
    expect(uploaded).toHaveLength(1);
  });

  it("does not call GitHub again for results already marked as synced", async () => {
    let writes = 0;
    await writeCachedResult(dir, result("missingOne1"));
    const syncStateFile = join(dir, "remote-sync.json");
    const remoteCache = {
      readResult: async () => {
        throw new Error("backfill should not preflight remote cache entries");
      },
      writeResult: async () => {
        writes += 1;
      },
    };

    await expect(backfillRemoteCache({ cacheDir: dir, remoteCache, syncStateFile })).resolves.toMatchObject({
      uploaded: 1,
    });
    await expect(backfillRemoteCache({ cacheDir: dir, remoteCache, syncStateFile })).resolves.toMatchObject({
      scanned: 0,
      uploaded: 0,
    });

    expect(writes).toBe(1);
  });

  it("marks the current uploaded result as synced before scanning", async () => {
    let writes = 0;
    const currentResult = result("currentDone");
    await writeCachedResult(dir, currentResult);

    const summary = await backfillRemoteCache({
      cacheDir: dir,
      syncedResults: [currentResult],
      remoteCache: {
        readResult: async () => undefined,
        writeResult: async () => {
          writes += 1;
        },
      },
    });

    expect(summary).toMatchObject({ scanned: 0, uploaded: 0 });
    expect(writes).toBe(0);
  });

  it.each([
    { name: "writes disabled", writeEnabled: false, token: "token" },
    { name: "missing token", writeEnabled: true, token: undefined },
  ])("keeps $name results eligible for a later upload", async ({ writeEnabled, token }) => {
    const cachedResult = result("retryLater1");
    await writeCachedResult(dir, cachedResult);
    let requests = 0;
    const remoteCache = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled,
        ...(token ? { token } : {}),
      },
      fetch: async () => {
        requests += 1;
        return new Response("", { status: 404 });
      },
    });

    const first = await backfillRemoteCache({ cacheDir: dir, remoteCache });
    expect(first.uploaded).toBe(0);
    expect(requests).toBe(0);

    const uploaded: string[] = [];
    const enabledCache = {
      readResult: async () => undefined,
      writeResult: async (value: LearningSubtitleResult) => { uploaded.push(value.videoId); },
    };
    const second = await backfillRemoteCache({ cacheDir: dir, remoteCache: enabledCache });
    expect(second.uploaded).toBe(1);
    expect(uploaded).toEqual([cachedResult.videoId]);
    expect(JSON.parse(await readFile(join(dir, ".remote-cache-backfill.json"), "utf8"))).toEqual({
      version: 2,
      synced: [`${cachedResult.videoId}/en/${WORKFLOW_VERSION}`],
      legacySynced: [],
    });
    const third = await backfillRemoteCache({ cacheDir: dir, remoteCache: enabledCache });
    expect(third.uploaded).toBe(0);
    expect(uploaded).toEqual([cachedResult.videoId]);
  });
});
