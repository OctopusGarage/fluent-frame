import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchVideoTitle } from "../src/videoMetadata.js";

let dir = "";

async function writeExecutable(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-video-metadata-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fetchVideoTitle", () => {
  it("reads the video title from yt-dlp output", async () => {
    const ytDlpPath = await writeExecutable(
      "fake-yt-dlp.mjs",
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (!args.includes("--print") || !args.includes("%(title)s")) {
  process.exit(2);
}
console.log("  10-Minute Match | Zidane & Henry  ");
`,
    );

    await expect(fetchVideoTitle("vZ5Bz6ILG5E", ytDlpPath)).resolves.toBe("10-Minute Match | Zidane & Henry");
  });
});
