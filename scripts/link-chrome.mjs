#!/usr/bin/env node
import { installNativeHost, logStep, readConfig, validateExtensionId } from "./local-common.mjs";

async function main() {
  const extensionId = validateExtensionId(process.argv[2] ?? "");
  const config = await readConfig();
  logStep("Linking Chrome extension to native host");
  await installNativeHost({ extensionId, config });
  console.log(`Linked chrome-extension://${extensionId}/`);
  console.log("Run pnpm run doctor to verify the connection.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
