import { spawn } from "node:child_process";

const AGENT_TIMEOUT_MS = 120_000;

function runAgentProcess(
  executablePath: string,
  args: string[],
  prompt: string,
  options: {
    cwd: string;
    displayName: string;
    stdioMode: "output-file" | "stdout-json";
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(executablePath, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${options.displayName} timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)} seconds`));
    }, AGENT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error.code === "ENOENT" ? new Error(`${options.displayName} CLI not found at ${executablePath}`) : error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve(options.stdioMode === "stdout-json" ? stdout : "");
      } else {
        reject(new Error(stderr.trim() || `${options.displayName.toLowerCase()} exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
}

export function runCodex(codexPath: string, prompt: string, cwd: string, outputPath: string): Promise<void> {
  return runAgentProcess(
    codexPath,
    [
      "exec",
      "--json",
      "--output-last-message",
      outputPath,
      "--cd",
      cwd,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ignore-rules",
    ],
    prompt,
    { cwd, displayName: "Codex", stdioMode: "output-file" },
  ).then(() => undefined);
}

export async function runClaude(claudePath: string, prompt: string, cwd: string): Promise<unknown> {
  const stdout = await runAgentProcess(
    claudePath,
    ["--print", "--output-format", "json", "--permission-mode", "dontAsk", "--no-session-persistence"],
    prompt,
    { cwd, displayName: "Claude", stdioMode: "stdout-json" },
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (parsed && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
    return JSON.parse((parsed as { result: string }).result) as unknown;
  }
  return parsed;
}
