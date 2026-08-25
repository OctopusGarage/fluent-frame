import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAPTION_DOWNLOAD_TIMEOUT_MS = 120_000;

type CaptionDownloadOptions = {
  timeoutMs?: number;
};

function captionDownloadErrorMessage(stderr: string, command: string, code: number | null): string {
  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) {
    return "YouTube is rate-limiting subtitle downloads. Try again later.";
  }
  return stderr.trim() || `${command} exited with ${code}`;
}

function run(command: string, args: string[], cwd: string, options: CaptionDownloadOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs = options.timeoutMs ?? CAPTION_DOWNLOAD_TIMEOUT_MS;
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Timed out while downloading captions"));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error.code === "ENOENT" ? new Error(`yt-dlp not found at ${command}`) : error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(captionDownloadErrorMessage(stderr, command, code)));
      }
    });
  });
}

function onlyFile(files: string[]): string {
  const [file] = files;
  if (file === undefined) {
    throw new Error("Expected one SRT caption file");
  }
  return file;
}

async function findSrtPath(dir: string, captionLanguage: string): Promise<string> {
  const srtFiles = (await readdir(dir)).filter((file) => file.endsWith(".srt"));
  if (srtFiles.length === 0) {
    throw new Error("yt-dlp did not produce an SRT caption file");
  }

  const languageMatches = srtFiles.filter((file) => file.includes(`.${captionLanguage}`));
  if (languageMatches.length === 1) {
    return join(dir, onlyFile(languageMatches));
  }
  if (languageMatches.length > 1) {
    throw new Error(`yt-dlp produced multiple SRT caption files for ${captionLanguage}`);
  }
  if (srtFiles.length === 1) {
    return join(dir, onlyFile(srtFiles));
  }
  throw new Error("yt-dlp produced multiple SRT caption files and none matched the requested language");
}

export async function downloadCaptions(
  videoId: string,
  captionLanguage: string,
  ytDlpPath: string,
  options: CaptionDownloadOptions = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ff-captions-"));
  try {
    await run(
      ytDlpPath,
      [
        "--write-auto-sub",
        "--write-sub",
        "--sub-lang",
        captionLanguage,
        "--sub-format",
        "srt",
        "--skip-download",
        "--output",
        "%(id)s.%(ext)s",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      dir,
      options,
    );
    const srtPath = await findSrtPath(dir, captionLanguage);
    return await readFile(srtPath, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
