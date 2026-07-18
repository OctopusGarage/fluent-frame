#!/usr/bin/env node
import { extensionDistPath, openChromeExtensions } from "./local-common.mjs";

async function main() {
  await openChromeExtensions();
  console.log("Load or reload FluentFrame from:");
  console.log(extensionDistPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
