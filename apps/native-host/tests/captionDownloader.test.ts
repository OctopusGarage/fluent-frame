import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadCaptions } from "../src/captionDownloader.js";

let dir = "";

async function writeExecutable(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-download-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("downloadCaptions", () => {
  it("discovers regional SRT output for requested caption language", async () => {
    const ytDlpPath = await writeExecutable(
      "fake-yt-dlp.mjs",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (!args.includes("--sub-format") || !args.includes("srt") || args.includes("--convert-subs")) {
  process.exit(2);
}
writeFileSync(join(process.cwd(), "dQw4w9WgXcQ.en-US.srt"), "regional captions");
`,
    );

    await expect(downloadCaptions("dQw4w9WgXcQ", "en", ytDlpPath)).resolves.toBe("regional captions");
  });

  it("rejects clearly when yt-dlp produces no SRT output", async () => {
    const ytDlpPath = await writeExecutable(
      "empty-yt-dlp.mjs",
      `#!/usr/bin/env node
`,
    );

    await expect(downloadCaptions("dQw4w9WgXcQ", "en", ytDlpPath)).rejects.toThrow(
      "yt-dlp did not produce an SRT caption file",
    );
  });

  it("reports when yt-dlp is missing", async () => {
    const ytDlpPath = join(dir, "missing-yt-dlp");

    await expect(downloadCaptions("dQw4w9WgXcQ", "en", ytDlpPath)).rejects.toThrow(
      `yt-dlp not found at ${ytDlpPath}`,
    );
  });

  it("times out when yt-dlp stalls while downloading captions", async () => {
    const ytDlpPath = await writeExecutable(
      "stalled-yt-dlp.mjs",
      `#!/usr/bin/env node
setInterval(() => {}, 1000);
`,
    );

    await expect(downloadCaptions("dQw4w9WgXcQ", "en", ytDlpPath, { timeoutMs: 50 })).rejects.toThrow(
      "Timed out while downloading captions",
    );
  });
});
