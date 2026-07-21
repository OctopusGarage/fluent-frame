import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentName } from "@fluent-frame/shared";

export type HostConfig = {
  dataDir: string;
  agent: AgentName;
  cacheDir: string;
  notesFile: string;
  queueFile: string;
  logFile: string;
  ytDlpPath: string;
  codexPath: string;
  claudePath: string;
  remoteCache: RemoteCacheConfig;
};

export type RemoteCacheConfig =
  | { enabled: false }
  | {
      enabled: true;
      provider: "github";
      owner: string;
      repo: string;
      branch: string;
      basePath: string;
      writeEnabled: boolean;
      tokenEnv?: string;
      token?: string;
    };

export type LocalConfigFile = Partial<{
  agent: AgentName;
  cacheDir: string;
  notesFile: string;
  queueFile: string;
  logFile: string;
  ytDlpPath: string;
  codexPath: string;
  claudePath: string;
  remoteCache: unknown;
}>;

function parseAgent(value: unknown): AgentName | undefined {
  return value === "codex" || value === "claude" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseGithubTokenEnv(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,120}$/.test(value)) {
    return undefined;
  }
  return value;
}

function parseRemoteCache(value: unknown, env: NodeJS.ProcessEnv): RemoteCacheConfig {
  if (!isRecord(value) || value.enabled !== true) {
    return { enabled: false };
  }
  if (value.provider !== "github") {
    return { enabled: false };
  }
  const owner = typeof value.owner === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value.owner) ? value.owner : undefined;
  const repo = typeof value.repo === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value.repo) ? value.repo : undefined;
  if (!owner || !repo) {
    return { enabled: false };
  }
  const branch = typeof value.branch === "string" && /^[A-Za-z0-9._/-]{1,200}$/.test(value.branch)
    ? value.branch
    : "main";
  const basePath = typeof value.basePath === "string" && /^[A-Za-z0-9._/-]{1,300}$/.test(value.basePath)
    ? value.basePath.replace(/^\/+|\/+$/g, "")
    : "data/youtube";
  if (!basePath || basePath.includes("..") || branch.includes("..")) {
    return { enabled: false };
  }
  const tokenEnv = parseGithubTokenEnv(value.tokenEnv);
  return {
    enabled: true,
    provider: "github",
    owner,
    repo,
    branch,
    basePath,
    writeEnabled: value.writeEnabled === true,
    ...(tokenEnv ? { tokenEnv } : {}),
    ...(tokenEnv && env[tokenEnv] ? { token: env[tokenEnv] } : {}),
  };
}

function remoteCacheFromEnv(env: NodeJS.ProcessEnv): unknown | undefined {
  if (env.FF_REMOTE_CACHE_PROVIDER !== "github") {
    return undefined;
  }
  return {
    enabled: true,
    provider: env.FF_REMOTE_CACHE_PROVIDER,
    owner: env.FF_REMOTE_CACHE_OWNER,
    repo: env.FF_REMOTE_CACHE_REPO,
    branch: env.FF_REMOTE_CACHE_BRANCH,
    basePath: env.FF_REMOTE_CACHE_BASE_PATH,
    writeEnabled: env.FF_REMOTE_CACHE_WRITE_ENABLED === "true",
    tokenEnv: env.FF_REMOTE_CACHE_TOKEN_ENV,
  };
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
  const dataDir = join(env.HOME ?? homedir(), ".fluent-frame");
  const localConfig = readLocalConfig(dataDir);
  const agent = parseAgent(env.FF_AGENT) ?? parseAgent(localConfig.agent) ?? "codex";
  return {
    dataDir,
    agent,
    cacheDir: env.FF_CACHE_DIR ?? localConfig.cacheDir ?? join(dataDir, "cache"),
    notesFile: env.FF_NOTES_FILE ?? localConfig.notesFile ?? join(dataDir, "notes.json"),
    queueFile: env.FF_QUEUE_FILE ?? localConfig.queueFile ?? join(dataDir, "queue", "jobs.json"),
    logFile: env.FF_LOG_FILE ?? localConfig.logFile ?? join(dataDir, "logs", "native-host.log"),
    ytDlpPath: env.FF_YTDLP_PATH ?? localConfig.ytDlpPath ?? "yt-dlp",
    codexPath: env.FF_CODEX_PATH ?? localConfig.codexPath ?? "codex",
    claudePath: env.FF_CLAUDE_PATH ?? localConfig.claudePath ?? "claude",
    remoteCache: parseRemoteCache(remoteCacheFromEnv(env) ?? localConfig.remoteCache, env),
  };
}
