import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKFLOW_VERSION } from "@fluent-frame/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCacheEntry } from "../src/cache.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-cache-policy-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cache policy", () => {
  it("returns a corrupt result instead of leaking string error policy", async () => {
    const cachePath = join(dir, "dQw4w9WgXcQ", "en", WORKFLOW_VERSION, "result.json");
    await mkdir(join(cachePath, ".."), { recursive: true });
    await writeFile(cachePath, "{", "utf8");

    await expect(readCacheEntry(dir, "dQw4w9WgXcQ", "en")).resolves.toMatchObject({
      status: "corrupt",
      message: "Invalid cached subtitle result",
    });
  });
});
