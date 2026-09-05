import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeHostName } from "./local-constants.mjs";
import { getChromeExtensionsOpenCommand } from "./local-workflow.mjs";

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const dataDir = join(homedir(), ".fluent-frame");
export const configPath = join(dataDir, "config.json");
export const extensionDistPath = join(rootDir, "apps", "extension", "dist");
export const nativeHostManifestPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "NativeMessagingHosts",
  `${nativeHostName}.json`,
);

export function logStep(message) {
  console.log(`\n${message}`);
}

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? "inherit",
    });
    let stdout = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

export async function resolveCommand(binaryName, explicitPath) {
  if (explicitPath?.trim()) {
    return explicitPath.trim();
  }

  const localCandidate = join(rootDir, binaryName);
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  const macosCandidate = join(rootDir, `${binaryName}-macos`);
  if (existsSync(macosCandidate)) {
    return macosCandidate;
  }

  try {
    const stdout = await run("/usr/bin/env", ["sh", "-lc", `command -v ${binaryName}`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return stdout.trim().split("\n")[0] || undefined;
  } catch {
    return undefined;
  }
}

export async function readConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

export async function writeConfig(config) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function validateExtensionId(extensionId) {
  const trimmed = extensionId.trim();
  if (!/^[a-p]{32}$/.test(trimmed)) {
    throw new Error("Chrome extension ID must be 32 lowercase letters from a to p.");
  }
  return trimmed;
}

export async function installNativeHost({ extensionId, config }) {
  const env = {};
  if (extensionId) {
    env.FF_EXTENSION_ID = extensionId;
  }
  if (config.agent) {
    env.FF_AGENT = config.agent;
  }
  if (config.ytDlpPath) {
    env.FF_YTDLP_PATH = config.ytDlpPath;
  }
  if (config.codexPath) {
    env.FF_CODEX_PATH = config.codexPath;
  }
  if (config.claudePath) {
    env.FF_CLAUDE_PATH = config.claudePath;
  }
  await run("pnpm", ["--filter", "@fluent-frame/native-host", "install:native-host"], { env });
}

export async function openChromeExtensions() {
  const openCommand = getChromeExtensionsOpenCommand(platform());
  if (!openCommand) {
    console.log("Open chrome://extensions in Chrome.");
    return;
  }
  try {
    await run(openCommand.command, openCommand.args, { stdio: "ignore" });
  } catch {
    await run("open", ["chrome://extensions"], { stdio: "ignore" });
  }
}

export async function removeLocalInstall() {
  await rm(nativeHostManifestPath, { force: true });
  await rm(join(dataDir, "bin", "native-host"), { force: true });
}
