#!/usr/bin/env node
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NATIVE_HOST_NAME } from "@fluent-frame/shared";

export const PLACEHOLDER_ALLOWED_ORIGIN = "chrome-extension://EXTENSION_ID_FROM_CHROME/";
export const LEGACY_NATIVE_HOST_NAME = "com.octopusgarage.youtube_english_coach";
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
  ytDlpPath?: string;
  codexPath?: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildNativeHostWrapper(config: NativeHostWrapperConfig | string): string {
  const wrapperConfig = typeof config === "string" ? { hostPath: config } : config;
  const pathEntries = [
    dirname(process.execPath),
    wrapperConfig.ytDlpPath ? dirname(wrapperConfig.ytDlpPath) : undefined,
    wrapperConfig.codexPath ? dirname(wrapperConfig.codexPath) : undefined,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter((entry, index, entries): entry is string => Boolean(entry) && entries.indexOf(entry) === index);
  const exports = [
    `export PATH=${shellQuote(`${pathEntries.join(delimiter)}:$PATH`)}`,
    wrapperConfig.ytDlpPath ? `export FF_YTDLP_PATH=${shellQuote(wrapperConfig.ytDlpPath)}` : undefined,
    wrapperConfig.codexPath ? `export FF_CODEX_PATH=${shellQuote(wrapperConfig.codexPath)}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const exportBlock = exports ? `${exports}\n` : "";
  return `#!/bin/sh
${exportBlock}exec "${process.execPath}" "${wrapperConfig.hostPath}"
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
  const hostPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "index.js");
  const wrapperDir = join(homedir(), ".fluent-frame", "bin");
  const wrapperPath = join(wrapperDir, "native-host");
  const existingManifest = await readExistingManifest(manifestPath);
  const allowedOrigins = resolveAllowedOrigins(existingManifest, extensionId);
  const manifest = buildNativeHostManifest(wrapperPath, allowedOrigins);
  const ytDlpPath = await resolveExecutablePath("yt-dlp", process.env.FF_YTDLP_PATH);
  const codexPath = await resolveExecutablePath("codex", process.env.FF_CODEX_PATH);
  const wrapperConfig: NativeHostWrapperConfig = { hostPath };
  if (ytDlpPath) {
    wrapperConfig.ytDlpPath = ytDlpPath;
  }
  if (codexPath) {
    wrapperConfig.codexPath = codexPath;
  }

  await mkdir(wrapperDir, { recursive: true });
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await installNativeHost();
}
