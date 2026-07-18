#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  configPath,
  extensionDistPath,
  logStep,
  nativeHostManifestPath,
  readConfig,
  resolveCommand,
} from "./local-common.mjs";

function ok(label, passed, detail = "") {
  const mark = passed ? "OK" : "MISSING";
  console.log(`${mark.padEnd(7)} ${label}${detail ? `: ${detail}` : ""}`);
  return passed;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(nativeHostManifestPath, "utf8"));
  } catch {
    return undefined;
  }
}

async function main() {
  console.log("FluentFrame Doctor");
  const config = await readConfig();
  const manifest = await readManifest();
  const ytDlpPath = await resolveCommand("yt-dlp", config.ytDlpPath);
  const codexPath = await resolveCommand("codex", config.codexPath);
  const claudePath = await resolveCommand("claude", config.claudePath);
  const selectedAgent = config.agent === "claude" ? "claude" : "codex";

  logStep("Install state");
  const extensionBuilt = ok("extension build", existsSync(extensionDistPath), extensionDistPath);
  const configExists = ok("local config", existsSync(configPath), configPath);
  const manifestExists = ok("native host manifest", Boolean(manifest), nativeHostManifestPath);
  const manifestLinked = ok(
    "Chrome extension origin",
    Array.isArray(manifest?.allowed_origins) &&
      manifest.allowed_origins.some((origin) => /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)),
    manifest?.allowed_origins?.join(", ") ?? "not linked",
  );

  logStep("Tools");
  const ytDlpOk = ok("yt-dlp", Boolean(ytDlpPath), ytDlpPath);
  const codexOk = ok("codex", Boolean(codexPath), codexPath);
  const claudeOk = ok("claude", Boolean(claudePath), claudePath);
  const agentOk = selectedAgent === "claude" ? claudeOk : codexOk;
  ok("selected agent", agentOk, selectedAgent);

  const healthy = extensionBuilt && configExists && manifestExists && manifestLinked && ytDlpOk && agentOk;
  logStep(healthy ? "FluentFrame is ready" : "Action needed");
  if (!healthy) {
    console.log("Common fixes:");
    console.log("- Build extension/native host: pnpm setup");
    console.log("- Link Chrome extension ID: pnpm link:chrome <extension-id>");
    console.log("- Override tool paths: FF_YTDLP_PATH=/path FF_CODEX_PATH=/path FF_CLAUDE_PATH=/path pnpm setup");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
