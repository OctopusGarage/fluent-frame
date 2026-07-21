import { parseHostRequest, type HostResponse } from "@fluent-frame/shared";
import { loadHostConfig } from "./config.js";
import { handleParsedRequest } from "./hostRequestHandlers.js";
import { createLogger } from "./logger.js";

export async function handleRequest(input: unknown, emit?: (response: HostResponse) => void): Promise<HostResponse> {
  let request;
  const config = loadHostConfig();
  const logger = createLogger(config.logFile);
  try {
    request = parseHostRequest(input);
  } catch (error) {
    await logger.log({
      level: "warn",
      component: "hostRouter",
      event: "request.rejected",
      message: "Rejected invalid native host request",
      details: { error },
    });
    return {
      id: "unknown",
      ok: false,
      type: "error",
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Invalid request",
    };
  }

  await logger.log({
    level: "info",
    component: "hostRouter",
    event: "request.started",
    message: `Handling ${request.type}`,
    requestId: request.id,
    ...("videoId" in request ? { videoId: request.videoId } : {}),
    details: { type: request.type },
  });
  const startedAt = Date.now();
  const response = await handleParsedRequest(request, { config, logger, ...(emit ? { emit } : {}) });
  await logger.log({
    level: response.ok ? "info" : "error",
    component: "hostRouter",
    event: response.ok ? "request.completed" : "request.failed",
    message: response.ok ? `Handled ${request.type}` : `Failed ${request.type}`,
    requestId: request.id,
    ...("videoId" in request ? { videoId: request.videoId } : {}),
    details: {
      type: request.type,
      responseType: response.type,
      elapsedMs: Date.now() - startedAt,
      ...(!response.ok ? { code: response.code, errorMessage: response.message } : {}),
    },
  });
  return response;
}
