import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { runVideoProcessingPipeline } from "./videoProcessingPipeline.js";

type ProcessVideoRequest = Extract<HostRequest, { type: "processVideo" }>;

export async function handleProcessVideoRequest(
  request: ProcessVideoRequest,
  context: { config: HostConfig; emit?: (response: HostResponse) => void },
): Promise<HostResponse> {
  const { config, emit } = context;
  const logger = createLogger(config.logFile);
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
        progress: { stage: "download", message: "Downloading YouTube captions" },
      });
    }
    const output = await runVideoProcessingPipeline(config, {
      videoId: request.videoId,
      captionLanguage: request.captionLanguage,
      ...(request.stream
        ? {
            onEvent(event) {
              if (event.type === "partialResult") {
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
                    message: `Generated batch ${event.completedBatches} of ${event.totalBatches}`,
                    completedBatches: event.completedBatches,
                    totalBatches: event.totalBatches,
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
    return { id: request.id, ok: true, type: "result", result: output.result };
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
