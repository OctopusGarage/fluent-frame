import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostConfig } from "./config.js";
import { createLogger } from "./logger.js";

type DetachedQueueWorkerProcess = {
  unref(): void;
};

export type DetachedQueueWorkerDeps = {
  entrypointPath?: string;
  env?: NodeJS.ProcessEnv;
  spawnDetached?: (
    command: string,
    args: string[],
    options: {
      detached: true;
      stdio: "ignore";
      env: NodeJS.ProcessEnv;
    },
  ) => DetachedQueueWorkerProcess;
};

function defaultEntrypointPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "index.js");
}

export async function startDetachedQueueWorker(config: HostConfig, deps: DetachedQueueWorkerDeps = {}): Promise<void> {
  const entrypointPath = deps.entrypointPath ?? defaultEntrypointPath();
  const child = (deps.spawnDetached ?? spawn)(process.execPath, [entrypointPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...(deps.env ?? process.env),
      FF_QUEUE_WORKER: "1",
      FF_AGENT: config.agent,
      FF_CACHE_DIR: config.cacheDir,
      FF_NOTES_FILE: config.notesFile,
      FF_QUEUE_FILE: config.queueFile,
      FF_LOG_FILE: config.logFile,
      FF_YTDLP_PATH: config.ytDlpPath,
      FF_CODEX_PATH: config.codexPath,
      FF_CLAUDE_PATH: config.claudePath,
      ...(config.remoteCache.enabled
        ? {
            FF_REMOTE_CACHE_PROVIDER: config.remoteCache.provider,
            FF_REMOTE_CACHE_OWNER: config.remoteCache.owner,
            FF_REMOTE_CACHE_REPO: config.remoteCache.repo,
            FF_REMOTE_CACHE_BRANCH: config.remoteCache.branch,
            FF_REMOTE_CACHE_BASE_PATH: config.remoteCache.basePath,
            FF_REMOTE_CACHE_WRITE_ENABLED: String(config.remoteCache.writeEnabled),
            ...(config.remoteCache.tokenEnv ? { FF_REMOTE_CACHE_TOKEN_ENV: config.remoteCache.tokenEnv } : {}),
            ...(config.remoteCache.tokenEnv && config.remoteCache.token ? { [config.remoteCache.tokenEnv]: config.remoteCache.token } : {}),
          }
        : {}),
    },
  });
  child.unref();
}

export function startQueue(config: HostConfig): void {
  void startDetachedQueueWorker(config).catch(async (error: unknown) => {
    await createLogger(config.logFile).log({
      level: "error",
      component: "queueWorker",
      event: "worker.startFailed",
      message: "Failed to start detached queue worker",
      details: { error },
    });
  });
}
