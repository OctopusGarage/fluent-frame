import { homedir } from "node:os";
import { join } from "node:path";

export type HostConfig = {
  cacheDir: string;
  notesFile: string;
  ytDlpPath: string;
  codexPath: string;
};

export function loadHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const dataDir = join(homedir(), ".fluent-frame");
  return {
    cacheDir: env.FF_CACHE_DIR ?? join(dataDir, "cache"),
    notesFile: env.FF_NOTES_FILE ?? join(dataDir, "notes.json"),
    ytDlpPath: env.FF_YTDLP_PATH ?? "yt-dlp",
    codexPath: env.FF_CODEX_PATH ?? "codex",
  };
}
