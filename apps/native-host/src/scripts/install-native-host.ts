#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NATIVE_HOST_NAME, type AgentName } from "@fluent-frame/shared";

export const PLACEHOLDER_ALLOWED_ORIGIN = "chrome-extension://EXTENSION_ID_FROM_CHROME/";
const LEGACY_NATIVE_HOST_NAME = "com.octopusgarage.youtube_english_coach";
const execFileAsync = promisify(execFile);

export type NativeHostManifest = {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
};

export type NativeHostWrapperConfig = {
  hostPath: string;
  agent?: AgentName;
  ytDlpPath?: string;
  codexPath?: string;
  claudePath?: string;
};

export type ManagedHostRuntimeInstallEntry = {
  from: string;
  to: string;
  recursive: boolean;
};

export function resolveManagedHostPath(scriptPath: string, homeDir = homedir()): string {
  return join(homeDir, ".fluent-frame", "host", "native-host", "index.js");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildNativeHostWrapper(config: NativeHostWrapperConfig | string): string {
  const wrapperConfig = typeof config === "string" ? { hostPath: config } : config;
  const pathEntries = [
    dirname(process.execPath),
    wrapperConfig.ytDlpPath ? dirname(wrapperConfig.ytDlpPath) : undefined,
    wrapperConfig.codexPath ? dirname(wrapperConfig.codexPath) : undefined,
    wrapperConfig.claudePath ? dirname(wrapperConfig.claudePath) : undefined,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter((entry, index, entries): entry is string => Boolean(entry) && entries.indexOf(entry) === index);
  const exports = [
    `export PATH=${shellQuote(`${pathEntries.join(delimiter)}:$PATH`)}`,
    wrapperConfig.agent ? `export FF_AGENT=${shellQuote(wrapperConfig.agent)}` : undefined,
    wrapperConfig.ytDlpPath ? `export FF_YTDLP_PATH=${shellQuote(wrapperConfig.ytDlpPath)}` : undefined,
    wrapperConfig.codexPath ? `export FF_CODEX_PATH=${shellQuote(wrapperConfig.codexPath)}` : undefined,
    wrapperConfig.claudePath ? `export FF_CLAUDE_PATH=${shellQuote(wrapperConfig.claudePath)}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const exportBlock = exports ? `${exports}\n` : "";
  return `#!/bin/sh
${exportBlock}if command -v launchctl >/dev/null 2>&1; then
  FLUENT_FRAME_GITHUB_TOKEN_VALUE="$(launchctl getenv FLUENT_FRAME_GITHUB_TOKEN 2>/dev/null || true)"
  if [ -n "$FLUENT_FRAME_GITHUB_TOKEN_VALUE" ]; then
    export FLUENT_FRAME_GITHUB_TOKEN="$FLUENT_FRAME_GITHUB_TOKEN_VALUE"
  fi
  unset FLUENT_FRAME_GITHUB_TOKEN_VALUE
fi
exec "${process.execPath}" "${wrapperConfig.hostPath}"
`;
}

export function buildNativeHostManifest(wrapperPath: string, allowedOrigins: string[]): NativeHostManifest {
  return {
    name: NATIVE_HOST_NAME,
    description: "FluentFrame local native host",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: allowedOrigins,
  };
}

export function resolveAllowedOrigins(existingManifest?: unknown, extensionId?: string): string[] {
  const trimmedExtensionId = extensionId?.trim();
  if (trimmedExtensionId) {
    if (!/^[a-p]{32}$/.test(trimmedExtensionId)) {
      throw new Error("Invalid Chrome extension ID");
    }
    return [`chrome-extension://${trimmedExtensionId}/`];
  }

  const existingAllowedOrigins =
    existingManifest && typeof existingManifest === "object"
      ? (existingManifest as { allowed_origins?: unknown }).allowed_origins
      : undefined;
  if (Array.isArray(existingAllowedOrigins)) {
    const preservedOrigins = existingAllowedOrigins.filter(
      (origin): origin is string => typeof origin === "string" && origin !== PLACEHOLDER_ALLOWED_ORIGIN,
    );
    if (preservedOrigins.length > 0) {
      return preservedOrigins;
    }
  }

  return [PLACEHOLDER_ALLOWED_ORIGIN];
}

export function resolveExtensionId(argv: string[], env: NodeJS.ProcessEnv): string | undefined {
  const flagIndex = argv.indexOf("--extension-id");
  if (flagIndex >= 0) {
    return argv[flagIndex + 1];
  }

  const inlineFlag = argv.find((arg) => arg.startsWith("--extension-id="));
  if (inlineFlag) {
    return inlineFlag.slice("--extension-id=".length);
  }

  return env.FF_EXTENSION_ID;
}

async function resolveExecutablePath(binaryName: string, envPath: string | undefined): Promise<string | undefined> {
  const trimmedEnvPath = envPath?.trim();
  if (trimmedEnvPath) {
    return trimmedEnvPath;
  }

  try {
    const { stdout } = await execFileAsync("/usr/bin/env", ["sh", "-lc", `command -v ${binaryName}`], {
      env: process.env,
    });
    const resolvedPath = stdout.trim().split("\n")[0];
    return resolvedPath || undefined;
  } catch {
    return undefined;
  }
}

async function readExistingManifest(manifestPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function removeLegacyNativeHostManifest(nativeMessagingDir: string): Promise<void> {
  const legacyManifestPath = join(nativeMessagingDir, `${LEGACY_NATIVE_HOST_NAME}.json`);
  await rm(legacyManifestPath, { force: true });
}

export function buildManagedHostRuntimeInstallPlan(sourceHostDir: string, managedHostDir: string): ManagedHostRuntimeInstallEntry[] {
  const repoRoot = resolve(sourceHostDir, "..", "..", "..");
  const sharedPackageDir = join(repoRoot, "packages", "shared");
  return [
    { from: sourceHostDir, to: managedHostDir, recursive: true },
    { from: join(repoRoot, "apps", "native-host", "prompts"), to: join(managedHostDir, "prompts"), recursive: true },
    { from: join(sharedPackageDir, "dist"), to: join(managedHostDir, "node_modules", "@fluent-frame", "shared", "dist"), recursive: true },
    { from: join(sharedPackageDir, "package.json"), to: join(managedHostDir, "node_modules", "@fluent-frame", "shared", "package.json"), recursive: false },
  ];
}

export function assertManagedHostRuntime(managedHostDir: string, exists: (path: string) => boolean = existsSync): void {
  const requiredPaths = [
    join(managedHostDir, "index.js"),
    join(managedHostDir, "prompts", "youtube-learning-subtitles.md"),
    join(managedHostDir, "node_modules", "@fluent-frame", "shared", "package.json"),
    join(managedHostDir, "node_modules", "@fluent-frame", "shared", "dist", "index.js"),
  ];
  const missingPaths = requiredPaths.filter((path) => !exists(path));
  if (missingPaths.length > 0) {
    throw new Error(`Managed native host runtime is incomplete: ${missingPaths.join(", ")}`);
  }
}

async function installManagedHostRuntime(sourceHostDir: string, managedHostDir: string): Promise<void> {
  const managedSharedDir = join(managedHostDir, "node_modules", "@fluent-frame", "shared");

  await rm(managedHostDir, { recursive: true, force: true });
  await mkdir(managedHostDir, { recursive: true });
  await mkdir(managedSharedDir, { recursive: true });
  for (const entry of buildManagedHostRuntimeInstallPlan(sourceHostDir, managedHostDir)) {
    await cp(entry.from, entry.to, { recursive: entry.recursive });
  }
  assertManagedHostRuntime(managedHostDir);
}

export async function installNativeHost(extensionId = resolveExtensionId(process.argv.slice(2), process.env)): Promise<void> {
  const chromeNativeMessagingDir = join(
    homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
  );
  const manifestPath = join(chromeNativeMessagingDir, `${NATIVE_HOST_NAME}.json`);
  const sourceHostDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const hostPath = resolveManagedHostPath(fileURLToPath(import.meta.url));
  const managedHostDir = dirname(hostPath);
  const wrapperDir = join(homedir(), ".fluent-frame", "bin");
  const wrapperPath = join(wrapperDir, "native-host");
  const existingManifest = await readExistingManifest(manifestPath);
  const allowedOrigins = resolveAllowedOrigins(existingManifest, extensionId);
  const manifest = buildNativeHostManifest(wrapperPath, allowedOrigins);
  const ytDlpPath = await resolveExecutablePath("yt-dlp", process.env.FF_YTDLP_PATH);
  const codexPath = await resolveExecutablePath("codex", process.env.FF_CODEX_PATH);
  const claudePath = await resolveExecutablePath("claude", process.env.FF_CLAUDE_PATH);
  const agent = process.env.FF_AGENT === "claude" ? "claude" : process.env.FF_AGENT === "codex" ? "codex" : undefined;
  const wrapperConfig: NativeHostWrapperConfig = { hostPath };
  if (agent) {
    wrapperConfig.agent = agent;
  }
  if (ytDlpPath) {
    wrapperConfig.ytDlpPath = ytDlpPath;
  }
  if (codexPath) {
    wrapperConfig.codexPath = codexPath;
  }
  if (claudePath) {
    wrapperConfig.claudePath = claudePath;
  }

  await mkdir(wrapperDir, { recursive: true });
  await installManagedHostRuntime(sourceHostDir, managedHostDir);
  await writeFile(wrapperPath, buildNativeHostWrapper(wrapperConfig), "utf8");
  await chmod(wrapperPath, 0o755);
  await mkdir(dirname(manifestPath), { recursive: true });
  await removeLegacyNativeHostManifest(chromeNativeMessagingDir);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Wrote ${manifestPath}`);
  console.log(`Wrote ${wrapperPath}`);
  if (allowedOrigins.includes(PLACEHOLDER_ALLOWED_ORIGIN)) {
    console.log("Replace EXTENSION_ID_FROM_CHROME with the unpacked extension ID shown in chrome://extensions.");
  }
  if (!ytDlpPath) {
    console.log("yt-dlp was not found during install. Rerun with FF_YTDLP_PATH=/absolute/path/to/yt-dlp.");
  }
  if (!codexPath) {
    console.log("Codex CLI was not found during install. Rerun with FF_CODEX_PATH=/absolute/path/to/codex.");
  }
  if (!claudePath) {
    console.log("Claude CLI was not found during install. Rerun with FF_CLAUDE_PATH=/absolute/path/to/claude.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await installNativeHost();
}
