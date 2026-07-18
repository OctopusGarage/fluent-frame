#!/usr/bin/env node
import { dataDir, logStep, nativeHostManifestPath, removeLocalInstall } from "./local-common.mjs";

async function main() {
  logStep("Removing FluentFrame local native-host registration");
  await removeLocalInstall();
  console.log(`Removed ${nativeHostManifestPath}`);
  console.log(`Kept user data in ${dataDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
