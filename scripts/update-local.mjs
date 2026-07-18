#!/usr/bin/env node
import {
  buildLocalUpdateSteps,
  buildNativeHostEnv,
  hasHelpFlag,
  shouldSkipPull,
  shouldUseFrozenLockfile,
} from "./local-workflow.mjs";
import { extensionDistPath, logStep, openChromeExtensions, readConfig, run } from "./local-common.mjs";

function printHelp() {
  console.log(`FluentFrame local update

Usage:
  pnpm local:update [--no-pull] [--no-frozen-lockfile]

Options:
  --no-pull             Skip git pull for local-only worktrees.
  --no-frozen-lockfile  Run pnpm install without --frozen-lockfile.
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (hasHelpFlag(argv)) {
    printHelp();
    return;
  }

  console.log("FluentFrame Local Update");
  console.log("Refresh the development-mode extension and native host.");

  const config = await readConfig();
  const steps = buildLocalUpdateSteps({
    pull: !shouldSkipPull(argv),
    frozenLockfile: shouldUseFrozenLockfile(argv),
  });
  const nativeHostEnv = buildNativeHostEnv(config);

  for (const step of steps) {
    logStep(step.label);
    const options =
      step.label === "Refresh native host registration" && Object.keys(nativeHostEnv).length > 0
        ? { env: nativeHostEnv }
        : undefined;
    await run(step.command, step.args, options);
  }

  logStep("Reload Chrome extension");
  await openChromeExtensions();
  console.log("In chrome://extensions, click Reload on FluentFrame.");
  console.log("Chrome will keep using this unpacked extension from:");
  console.log(extensionDistPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
