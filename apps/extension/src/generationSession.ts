import type { LearningSubtitleResult } from "@fluent-frame/shared";
import type { CoachUi } from "./ui.js";
import { estimateGenerationDuration, formatDuration, writeGenerationRecord } from "./generationHistory.js";
import { generationProgressMessage } from "./generationProgress.js";
import type { ActiveLearningGeneration, LearningGenerationClient } from "./learningGenerationClient.js";

export type VideoLearningSession = {
  start(videoId: string): void;
  cancel(): void;
  handleNavigation(videoId: string | undefined): void;
};

export type VideoLearningSessionDeps = {
  doc: Document;
  win: Window;
  generationClient: LearningGenerationClient;
  ui: CoachUi;
  currentVideoId(): string | undefined;
  reconcilePlayerUi(): void;
};

export function createVideoLearningSession(deps: VideoLearningSessionDeps): VideoLearningSession {
  let latestRequestSequence = 0;
  let progressTimer: number | undefined;
  let activeGeneration:
    | {
        videoId: string;
        requestSequence: number;
        startedMs: number;
        request?: ActiveLearningGeneration;
        disconnecting: boolean;
      }
    | undefined;
  let lastVideoId = deps.currentVideoId();

  function stopGenerationProgress(): void {
    if (progressTimer !== undefined) {
      const clear = deps.win.clearInterval ?? deps.doc.defaultView?.clearInterval ?? globalThis.clearInterval;
      clear(progressTimer);
      progressTimer = undefined;
    }
  }

  function startGenerationProgress(startedMs: number, estimate: string | undefined): void {
    stopGenerationProgress();
    deps.ui.setProgress(generationProgressMessage(startedMs, estimate));
    progressTimer = deps.win.setInterval(() => {
      deps.ui.setProgress(generationProgressMessage(startedMs, estimate));
    }, 1000) as unknown as number;
  }

  function record(videoId: string, startedMs: number, status: "success" | "failed"): number {
    const finishedMs = Date.now();
    const elapsedMs = Math.max(0, finishedMs - startedMs);
    writeGenerationRecord(deps.win, {
      videoId,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
      elapsedMs,
      status,
    });
    return elapsedMs;
  }

  function cancel(): void {
    if (!activeGeneration) {
      return;
    }
    activeGeneration.disconnecting = true;
    activeGeneration.request?.disconnect();
    activeGeneration = undefined;
    stopGenerationProgress();
  }

  function isStale(requestSequence: number, videoId: string): boolean {
    const currentVideoId = deps.currentVideoId();
    return requestSequence !== latestRequestSequence || currentVideoId !== videoId;
  }

  function finishFailure(videoId: string, startedMs: number, message: string): void {
    stopGenerationProgress();
    activeGeneration = undefined;
    record(videoId, startedMs, "failed");
    deps.ui.setError(message);
  }

  function finishSuccess(videoId: string, startedMs: number, result: LearningSubtitleResult): void {
    stopGenerationProgress();
    activeGeneration = undefined;
    const elapsedMs = record(videoId, startedMs, "success");
    deps.ui.setResult(result, `Learning subtitles ready in ${formatDuration(elapsedMs)}`);
    deps.reconcilePlayerUi();
  }

  function startClientRequest(videoId: string, requestSequence: number, startedMs: number, estimate: string | undefined): void {
    const request = deps.generationClient.start(videoId, {
      onProgress(progress) {
        if (isStale(requestSequence, videoId)) {
          return;
        }
        const batchText = progress.totalBatches
          ? ` · batch ${progress.completedBatches ?? 0}/${progress.totalBatches}`
          : "";
        deps.ui.setProgress(`${progress.message}${batchText} · ${generationProgressMessage(startedMs, estimate)}`);
      },
      onPartialResult(result, progress) {
        if (isStale(requestSequence, videoId)) {
          return;
        }
        deps.ui.setResult(result, "Learning subtitles streaming...");
        deps.ui.setProgress(`Batch ${progress.completedBatches} of ${progress.totalBatches} ready · ${generationProgressMessage(startedMs, estimate)}`);
        deps.reconcilePlayerUi();
      },
      onResult(result) {
        if (!isStale(requestSequence, videoId)) {
          finishSuccess(videoId, startedMs, result);
        }
      },
      onError(message) {
        if (!isStale(requestSequence, videoId)) {
          finishFailure(videoId, startedMs, message);
        }
      },
      onDisconnect() {
        if (!activeGeneration || activeGeneration.requestSequence !== requestSequence || activeGeneration.disconnecting) {
          return;
        }
        stopGenerationProgress();
        activeGeneration = undefined;
        deps.ui.setError("Local helper disconnected before generation finished.");
      },
    });
    if (activeGeneration?.requestSequence === requestSequence) {
      activeGeneration.request = request;
    }
  }

  function start(videoId: string): void {
    if (activeGeneration?.videoId === videoId) {
      deps.ui.setProgress(`Already generating this video · ${generationProgressMessage(activeGeneration.startedMs, estimateGenerationDuration(deps.win))}`);
      return;
    }
    cancel();
    const requestSequence = latestRequestSequence + 1;
    latestRequestSequence = requestSequence;
    const startedMs = Date.now();
    const estimate = estimateGenerationDuration(deps.win);
    activeGeneration = { videoId, requestSequence, startedMs, disconnecting: false };
    deps.ui.clearResult(estimate ? `Generating learning subtitles... ETA about ${estimate}` : "Generating learning subtitles... ETA after first run");
    startGenerationProgress(startedMs, estimate);
    startClientRequest(videoId, requestSequence, startedMs, estimate);
  }

  function handleNavigation(videoId: string | undefined): void {
    if (videoId && videoId !== lastVideoId) {
      lastVideoId = videoId;
      latestRequestSequence += 1;
      cancel();
      deps.ui.clearResult("Ready");
    }
  }

  return { start, cancel, handleNavigation };
}
