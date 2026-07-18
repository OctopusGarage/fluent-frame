import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentName } from "@fluent-frame/shared";

export type HostConfig = {
  dataDir: string;
  agent: AgentName;
  cacheDir: string;
  notesFile: string;
  ytDlpPath: string;
  codexPath: string;
  claudePath: string;
};

export type LocalConfigFile = Partial<{
  agent: AgentName;
  cacheDir: string;
  notesFile: string;
  ytDlpPath: string;
  codexPath: string;
  claudePath: string;
}>;

function parseAgent(value: unknown): AgentName | undefined {
  return value === "codex" || value === "claude" ? value : undefined;
}

function readLocalConfig(dataDir: string): LocalConfigFile {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as LocalConfigFile;
  } catch {
    return {};
  }
}

export function loadHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const dataDir = join(homedir(), ".fluent-frame");
  const localConfig = readLocalConfig(dataDir);
  const agent = parseAgent(env.FF_AGENT) ?? parseAgent(localConfig.agent) ?? "codex";
  return {
    dataDir,
    agent,
    cacheDir: env.FF_CACHE_DIR ?? localConfig.cacheDir ?? join(dataDir, "cache"),
    notesFile: env.FF_NOTES_FILE ?? localConfig.notesFile ?? join(dataDir, "notes.json"),
    ytDlpPath: env.FF_YTDLP_PATH ?? localConfig.ytDlpPath ?? "yt-dlp",
    codexPath: env.FF_CODEX_PATH ?? localConfig.codexPath ?? "codex",
    claudePath: env.FF_CLAUDE_PATH ?? localConfig.claudePath ?? "claude",
  };
}
