import { spawn } from "node:child_process";

const TITLE_TIMEOUT_MS = 15_000;

function cleanTitle(value: string): string | undefined {
  const title = value.replace(/\s+/g, " ").trim();
  return title && title.length <= 500 ? title : undefined;
}

export function fetchVideoTitle(videoId: string, ytDlpPath: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ytDlpPath,
      [
        "--skip-download",
        "--no-warnings",
        "--print",
        "%(title)s",
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while reading video title"));
    }, TITLE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      reject(error.code === "ENOENT" ? new Error(`yt-dlp not found at ${ytDlpPath}`) : error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${ytDlpPath} exited with ${code}`));
        return;
      }
      resolve(cleanTitle(stdout.split("\n")[0] ?? ""));
    });
  });
}
