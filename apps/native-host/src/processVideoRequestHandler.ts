import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";

type ProcessVideoRequest = Extract<HostRequest, { type: "processVideo" }>;

export async function handleProcessVideoRequest(
  request: ProcessVideoRequest,
  context: { config: HostConfig; emit?: (response: HostResponse) => void },
): Promise<HostResponse> {
  const { config, emit } = context;
  try {
    if (request.stream) {
      emit?.({
        id: request.id,
        ok: true,
        type: "progress",
        progress: { stage: "download", message: "Downloading YouTube captions" },
      });
    }
    const { createConfiguredRunner } = await import("./agentRunner.js");
    const { downloadCaptions } = await import("./captionDownloader.js");
    const { processVideo } = await import("./processor.js");
    const runAgent = await createConfiguredRunner(config.agent, {
      codexPath: config.codexPath,
      claudePath: config.claudePath,
    });
    const output = await processVideo(request.videoId, request.captionLanguage, {
      cacheDir: config.cacheDir,
      downloadCaptions: (videoId, captionLanguage) => downloadCaptions(videoId, captionLanguage, config.ytDlpPath),
      runAgent,
      ...(request.stream
        ? {
            onEvent(event) {
              if (event.type === "partialResult") {
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
    return { id: request.id, ok: true, type: "result", result: output.result };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      type: "error",
      code: "PROCESSING_ERROR",
      message: error instanceof Error ? error.message : "Video processing failed",
    };
  }
}
