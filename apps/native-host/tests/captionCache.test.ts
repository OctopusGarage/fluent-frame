import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCachedCaptions, writeCachedCaptions } from "../src/captionCache.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-caption-cache-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("caption cache", () => {
  it("persists downloaded caption text by video and language", async () => {
    await writeCachedCaptions(dir, "dQw4w9WgXcQ", "en", "1\n00:00:00,000 --> 00:00:01,000\nLine.\n");

    await expect(readCachedCaptions(dir, "dQw4w9WgXcQ", "en")).resolves.toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nLine.\n",
    );
    await expect(readCachedCaptions(dir, "dQw4w9WgXcQ", "zh-Hans")).resolves.toBeUndefined();
  });

  it("treats malformed caption cache files as misses", async () => {
    await mkdir(join(dir, "dQw4w9WgXcQ", "en"), { recursive: true });
    await writeFile(join(dir, "dQw4w9WgXcQ", "en", "captions.json"), "{", "utf8");

    await expect(readCachedCaptions(dir, "dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });
});
