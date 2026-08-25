import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { runVideoProcessingPipeline } from "./videoProcessingPipeline.js";

type ProcessVideoRequest = Extract<HostRequest, { type: "processVideo" }>;

function countFlag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function cacheStatusMessage(event: {
  localResult: boolean;
  remoteResult: boolean;
  partialResult: boolean;
  cachedBatches: number;
  totalBatches?: number;
}): string {
  const partsText = event.totalBatches ? `, cached parts ${event.cachedBatches}/${event.totalBatches}` : "";
  return `Cache check: local result ${countFlag(event.localResult)}, partial checkpoint ${countFlag(event.partialResult)}, remote result ${countFlag(event.remoteResult)}${partsText}`;
}

export async function handleProcessVideoRequest(
  request: ProcessVideoRequest,
  context: { config: HostConfig; logger: Logger; emit?: (response: HostResponse) => void },
): Promise<HostResponse> {
  const { config, logger, emit } = context;
  try {
    await logger.log({
      level: "info",
      component: "processor",
      event: "generation.started",
      message: "Starting learning subtitle generation request",
      requestId: request.id,
      videoId: request.videoId,
      details: { captionLanguage: request.captionLanguage, stream: Boolean(request.stream) },
    });
    if (request.stream) {
      emit?.({
        id: request.id,
        ok: true,
        type: "progress",
        progress: { stage: "cache", message: "Checking subtitle cache" },
      });
    }
    const output = await runVideoProcessingPipeline(config, {
      videoId: request.videoId,
      captionLanguage: request.captionLanguage,
      ...(request.stream
        ? {
            onEvent(event) {
              if (event.type === "cacheStatus") {
                emit?.({
                  id: request.id,
                  ok: true,
                  type: "progress",
                  progress: {
                    stage: "cache",
                    message: cacheStatusMessage(event),
                    ...(event.totalBatches ? { totalBatches: event.totalBatches } : {}),
                    cache: {
                      localResult: event.localResult,
                      remoteResult: event.remoteResult,
                      partialResult: event.partialResult,
                      cachedBatches: event.cachedBatches,
                      ...(event.totalBatches ? { totalBatches: event.totalBatches } : {}),
                    },
                  },
                });
                return;
              }
              if (event.type === "partialResult") {
                const activeBatch = event.completedBatches < event.totalBatches ? event.completedBatches + 1 : event.totalBatches;
                void logger.log({
                  level: "info",
                  component: "processor",
                  event: "generation.partial",
                  message: "Generated partial learning subtitle batch",
                  requestId: request.id,
                  videoId: request.videoId,
                  details: { completedBatches: event.completedBatches, totalBatches: event.totalBatches },
                });
                emit?.({
                  id: request.id,
                  ok: true,
                  type: "progress",
                  progress: {
                    stage: "agent",
                    message: `Part ${event.completedBatches} of ${event.totalBatches} ready`,
                    completedBatches: event.completedBatches,
                    totalBatches: event.totalBatches,
                    activeBatch,
                  },
                });
                emit?.({
                  id: request.id,
                  ok: true,
                  type: "partialResult",
                  result: event.result,
                  completedBatches: event.completedBatches,
                  totalBatches: event.totalBatches,
                });
                return;
              }
              emit?.({
                id: request.id,
                ok: true,
                type: "progress",
                progress: {
                  stage: "agent",
                  message: event.mode === "partialFallback"
                    ? `Using partial learning subtitles: ${event.reason}`
                    : `Using source subtitles: ${event.reason}`,
                },
              });
            },
          }
        : {}),
    });
    if (request.stream) {
      emit?.({
        id: request.id,
        ok: true,
        type: "progress",
        progress: { stage: "done", message: "Finalizing learning subtitles" },
      });
    }
    await logger.log({
      level: output.mode === "generated" || output.mode === "cache" || output.mode === "remoteCache" ? "info" : "warn",
      component: "processor",
      event: "generation.completed",
      message: "Completed learning subtitle generation request",
      requestId: request.id,
      videoId: request.videoId,
      details: { mode: output.mode, fallbackReason: output.fallbackReason },
    });
    return {
      id: request.id,
      ok: true,
      type: "result",
      result: output.result,
      mode: output.mode,
      cacheHit: output.cacheHit,
      ...(output.fallbackReason ? { fallbackReason: output.fallbackReason } : {}),
    };
  } catch (error) {
    await logger.log({
      level: "error",
      component: "processor",
      event: "generation.failed",
      message: "Learning subtitle generation request failed",
      requestId: request.id,
      videoId: request.videoId,
      details: { error },
    });
    return {
      id: request.id,
      ok: false,
      type: "error",
      code: "PROCESSING_ERROR",
      message: error instanceof Error ? error.message : "Video processing failed",
    };
  }
}
