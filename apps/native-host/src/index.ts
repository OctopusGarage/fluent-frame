#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type HostResponse } from "@fluent-frame/shared";
import { handleRequest } from "./hostRouter.js";
import { readNativeMessage, writeNativeMessage } from "./nativeMessaging.js";

export { handleRequest };

async function main(): Promise<void> {
  const input = await readNativeMessage();
  writeNativeMessage(await handleRequest(input, (response) => {
    writeNativeMessage(response);
  }));
}

function isEntrypoint(): boolean {
  const invokedPath = process.argv[1];
  return invokedPath ? realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(invokedPath)) : false;
}

if (isEntrypoint()) {
  main().catch((error) => {
    const response: HostResponse = {
      id: "unknown",
      ok: false,
      type: "error",
      code: "HOST_CRASH",
      message: error instanceof Error ? error.message : "Native host crashed",
    };
    writeNativeMessage(response);
  });
}
