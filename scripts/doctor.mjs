#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  configPath,
  extensionDistPath,
  logStep,
  nativeHostManifestPath,
  readConfig,
  resolveCommand,
} from "./local-common.mjs";

export const managedNativeHostPath = join(homedir(), ".fluent-frame", "host", "native-host", "index.js");

function ok(label, passed, detail = "") {
  const mark = passed ? "OK" : "MISSING";
  console.log(`${mark.padEnd(7)} ${label}${detail ? `: ${detail}` : ""}`);
  return passed;
}

function remoteCacheSummary(config) {
  const remoteCache = config.remoteCache;
  if (!remoteCache || remoteCache.enabled !== true || remoteCache.provider !== "github") {
    return { enabled: false };
  }
  const tokenEnv = typeof remoteCache.tokenEnv === "string" ? remoteCache.tokenEnv : undefined;
  return {
    enabled: true,
    detail: `${remoteCache.owner}/${remoteCache.repo}@${remoteCache.branch ?? "main"}:${remoteCache.basePath ?? "data/youtube"}`,
    writeEnabled: remoteCache.writeEnabled === true,
    tokenEnv,
    tokenConfigured: tokenEnv ? Boolean(process.env[tokenEnv]) : false,
  };
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(nativeHostManifestPath, "utf8"));
  } catch {
    return undefined;
  }
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export function parseWrapperExec(wrapperContent) {
  const execLine = wrapperContent
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("exec "));
  const match = execLine?.match(/^exec\s+"([^"]+)"\s+"([^"]+)"$/);
  if (!match) {
    return undefined;
  }
  return { nodePath: match[1], hostPath: match[2] };
}

export function evaluateNativeHostRegistration({
  manifest,
  wrapperContent,
  exists = existsSync,
  nativeHostManifestLocation = nativeHostManifestPath,
  managedHostPath = managedNativeHostPath,
}) {
  const manifestPath = typeof manifest?.path === "string" ? manifest.path : undefined;
  const originDetail = Array.isArray(manifest?.allowed_origins) ? manifest.allowed_origins.join(", ") : "not linked";
  const linkedOrigin = Array.isArray(manifest?.allowed_origins) &&
    manifest.allowed_origins.some((origin) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin));
  const wrapperExec = wrapperContent ? parseWrapperExec(wrapperContent) : undefined;

  let wrapperDetail = manifestPath ?? "manifest path missing";
  if (manifestPath && !exists(manifestPath)) {
    wrapperDetail = `${manifestPath} does not exist`;
  }

  let nodeResult = { ok: false, detail: "wrapper exec line missing" };
  if (wrapperExec?.nodePath) {
    nodeResult = exists(wrapperExec.nodePath)
      ? { ok: true, detail: wrapperExec.nodePath }
      : { ok: false, detail: `${wrapperExec.nodePath} does not exist` };
  }

  let targetResult = { ok: false, detail: "wrapper exec line missing" };
  if (wrapperExec?.hostPath) {
    if (!exists(wrapperExec.hostPath)) {
      targetResult = { ok: false, detail: `${wrapperExec.hostPath} does not exist` };
    } else if (wrapperExec.hostPath !== managedHostPath) {
      targetResult = {
        ok: false,
        detail: `${wrapperExec.hostPath} is not the managed host ${managedHostPath}`,
      };
    } else {
      targetResult = { ok: true, detail: wrapperExec.hostPath };
    }
  }

  return {
    manifest: manifest ? { ok: true, detail: nativeHostManifestLocation } : { ok: false, detail: nativeHostManifestLocation },
    origin: { ok: linkedOrigin, detail: originDetail },
    wrapper: { ok: Boolean(manifestPath && exists(manifestPath) && wrapperContent), detail: wrapperDetail },
    node: nodeResult,
    wrapperTarget: targetResult,
  };
}

async function main() {
  console.log("FluentFrame Doctor");
  const config = await readConfig();
  const manifest = await readManifest();
  const wrapperContent = await readText(manifest?.path);
  const nativeHostRegistration = evaluateNativeHostRegistration({ manifest, wrapperContent });
  const ytDlpPath = await resolveCommand("yt-dlp", config.ytDlpPath);
  const codexPath = await resolveCommand("codex", config.codexPath);
  const claudePath = await resolveCommand("claude", config.claudePath);
  const selectedAgent = config.agent === "claude" ? "claude" : "codex";

  logStep("Install state");
  const extensionBuilt = ok("extension build", existsSync(extensionDistPath), extensionDistPath);
  const configExists = ok("local config", existsSync(configPath), configPath);
  const manifestExists = ok("native host manifest", nativeHostRegistration.manifest.ok, nativeHostRegistration.manifest.detail);
  const manifestLinked = ok("Chrome extension origin", nativeHostRegistration.origin.ok, nativeHostRegistration.origin.detail);
  const wrapperOk = ok("native host wrapper", nativeHostRegistration.wrapper.ok, nativeHostRegistration.wrapper.detail);
  const nodeOk = ok("native host node", nativeHostRegistration.node.ok, nativeHostRegistration.node.detail);
  const wrapperTargetOk = ok("native host target", nativeHostRegistration.wrapperTarget.ok, nativeHostRegistration.wrapperTarget.detail);

  logStep("Tools");
  const ytDlpOk = ok("yt-dlp", Boolean(ytDlpPath), ytDlpPath);
  const codexOk = ok("codex", Boolean(codexPath), codexPath);
  const claudeOk = ok("claude", Boolean(claudePath), claudePath);
  const agentOk = selectedAgent === "claude" ? claudeOk : codexOk;
  ok("selected agent", agentOk, selectedAgent);

  logStep("Remote cache");
  const remoteCache = remoteCacheSummary(config);
  if (!remoteCache.enabled) {
    ok("GitHub remote cache", true, "disabled");
  } else {
    ok("GitHub remote cache", true, remoteCache.detail);
    ok("GitHub remote writes", remoteCache.writeEnabled, remoteCache.writeEnabled ? "enabled" : "disabled");
    if (remoteCache.tokenEnv) {
      ok("GitHub token env", remoteCache.tokenConfigured, remoteCache.tokenConfigured
        ? `${remoteCache.tokenEnv} is set`
        : `${remoteCache.tokenEnv} is not set in this shell`);
    } else {
      ok("GitHub token env", false, "not configured; public read-only cache only");
    }
  }

  const healthy =
    extensionBuilt &&
    configExists &&
    manifestExists &&
    manifestLinked &&
    wrapperOk &&
    nodeOk &&
    wrapperTargetOk &&
    ytDlpOk &&
    agentOk;
  logStep(healthy ? "FluentFrame is ready" : "Action needed");
  if (!healthy) {
    console.log("Common fixes:");
    console.log("- Build extension/native host: pnpm setup");
    console.log("- Link Chrome extension ID: pnpm link:chrome <extension-id>");
    console.log("- Refresh stale native host wrapper: pnpm link:chrome <extension-id>");
    console.log("- Override tool paths: FF_YTDLP_PATH=/path FF_CODEX_PATH=/path FF_CLAUDE_PATH=/path pnpm setup");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
