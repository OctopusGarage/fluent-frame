#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  configPath,
  extensionDistPath,
  installNativeHost,
  logStep,
  nativeHostManifestPath,
  openChromeExtensions,
  readConfig,
  resolveCommand,
  run,
  validateExtensionId,
  writeConfig,
} from "./local-common.mjs";

function displayPath(value) {
  return value || "not found";
}

function chooseDefaultAgent(codexPath, claudePath) {
  if (codexPath) {
    return "codex";
  }
  if (claudePath) {
    return "claude";
  }
  return "codex";
}

async function promptAgent(rl, defaultAgent, codexPath, claudePath) {
  console.log(`Codex: ${displayPath(codexPath)}`);
  console.log(`Claude: ${displayPath(claudePath)}`);
  const answer = await rl.question(`Choose local agent [${defaultAgent}/claude/codex]: `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return defaultAgent;
  }
  if (normalized === "codex" || normalized === "claude") {
    return normalized;
  }
  console.log(`Unknown agent "${answer}". Using ${defaultAgent}.`);
  return defaultAgent;
}

async function main() {
  console.log("FluentFrame Local Setup");
  console.log("Development-mode install with local native host.");

  logStep("Checking local tools");
  const existingConfig = await readConfig();
  const ytDlpPath = await resolveCommand("yt-dlp", process.env.FF_YTDLP_PATH ?? existingConfig.ytDlpPath);
  const codexPath = await resolveCommand("codex", process.env.FF_CODEX_PATH ?? existingConfig.codexPath);
  const claudePath = await resolveCommand("claude", process.env.FF_CLAUDE_PATH ?? existingConfig.claudePath);
  console.log(`yt-dlp: ${displayPath(ytDlpPath)}`);
  console.log(`codex: ${displayPath(codexPath)}`);
  console.log(`claude: ${displayPath(claudePath)}`);

  const rl = createInterface({ input, output });
  try {
    const defaultAgent = existingConfig.agent === "claude" || existingConfig.agent === "codex"
      ? existingConfig.agent
      : chooseDefaultAgent(codexPath, claudePath);
    const agent = await promptAgent(rl, defaultAgent, codexPath, claudePath);
    const config = {
      agent,
      ...(ytDlpPath ? { ytDlpPath } : {}),
      ...(codexPath ? { codexPath } : {}),
      ...(claudePath ? { claudePath } : {}),
    };

    logStep("Writing local config");
    await writeConfig(config);
    console.log(`Wrote ${configPath}`);

    logStep("Installing dependencies and building");
    await run("pnpm", ["install"]);
    await run("pnpm", ["build"]);

    logStep("Installing native host");
    await installNativeHost({ config });
    console.log(`Native host manifest: ${nativeHostManifestPath}`);

    logStep("Opening Chrome extensions page");
    await openChromeExtensions();
    console.log("Enable Developer Mode, click Load unpacked, and select:");
    console.log(extensionDistPath);

    const extensionId = await rl.question("Paste the Chrome extension ID now, or press Enter to link later: ");
    if (extensionId.trim()) {
      const validatedExtensionId = validateExtensionId(extensionId);
      await installNativeHost({ extensionId: validatedExtensionId, config });
      console.log(`Linked Chrome extension ID: ${validatedExtensionId}`);
    } else {
      console.log("Link later with: pnpm link:chrome <extension-id>");
    }

    logStep("Final check");
    try {
      await run("pnpm", ["run", "doctor"]);
    } catch {
      console.log("Doctor found remaining setup work. Finish the Chrome linking step, then rerun pnpm run doctor.");
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
