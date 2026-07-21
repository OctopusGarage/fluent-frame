import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { WORKFLOW_VERSION, type HostHealth } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";

const execFileAsync = promisify(execFile);

async function executableExists(path: string): Promise<boolean> {
  if (!path.includes("/")) {
    try {
      await execFileAsync("/usr/bin/env", ["sh", "-lc", `command -v ${path}`]);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildHealth(config: HostConfig): Promise<HostHealth> {
  const [ytDlp, codex, claude] = await Promise.all([
    executableExists(config.ytDlpPath),
    executableExists(config.codexPath),
    executableExists(config.claudePath),
  ]);
  return {
    version: "0.1.0",
    workflowVersion: WORKFLOW_VERSION,
    agent: config.agent,
    cacheDir: config.cacheDir,
    notesFile: config.notesFile,
    ytDlpPath: config.ytDlpPath,
    codexPath: config.codexPath,
    claudePath: config.claudePath,
    checks: { ytDlp, codex, claude },
  };
}
