import { parseHostRequest, type HostResponse } from "@fluent-frame/shared";
import { loadHostConfig } from "./config.js";
import { handleParsedRequest } from "./hostRequestHandlers.js";

export async function handleRequest(input: unknown, emit?: (response: HostResponse) => void): Promise<HostResponse> {
  let request;
  try {
    request = parseHostRequest(input);
  } catch (error) {
    return {
      id: "unknown",
      ok: false,
      type: "error",
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Invalid request",
    };
  }

  const config = loadHostConfig();
  return handleParsedRequest(request, { config, ...(emit ? { emit } : {}) });
}
