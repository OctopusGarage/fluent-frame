import type { LearningSubtitleResult } from "@fluent-frame/shared";
import type { CoachUi } from "./ui.js";
import { estimateGenerationDuration, formatDuration, writeGenerationRecord } from "./generationHistory.js";
import { generationProgressMessage } from "./generationProgress.js";
import type { ActiveLearningGeneration, LearningGenerationClient, LearningGenerationResultMeta } from "./learningGenerationClient.js";

type CacheProgress = {
  localResult: boolean;
  remoteResult: boolean;
  partialResult: boolean;
  cachedBatches: number;
  totalBatches?: number;
};

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
        statusPrefix?: string;
        cache?: CacheProgress;
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

  function statusMessage(startedMs: number, estimate: string | undefined): string {
    const suffix = generationProgressMessage(startedMs, estimate);
    return activeGeneration?.statusPrefix ? `${activeGeneration.statusPrefix} · ${suffix}` : suffix;
  }

  function startGenerationProgress(startedMs: number, estimate: string | undefined): void {
    stopGenerationProgress();
    deps.ui.setProgress(statusMessage(startedMs, estimate));
    progressTimer = deps.win.setInterval(() => {
      deps.ui.setProgress(statusMessage(startedMs, estimate));
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

  function finishIncomplete(videoId: string, startedMs: number, result: LearningSubtitleResult, meta: LearningGenerationResultMeta): void {
    stopGenerationProgress();
    activeGeneration = undefined;
    record(videoId, startedMs, "failed");
    const detail = meta.fallbackReason ? `: ${meta.fallbackReason}` : "";
    const message = meta.mode === "sourceFallback"
      ? `Source subtitles only${detail}`
      : `Partial subtitles saved${detail}`;
    deps.ui.setResult(result, message);
    deps.reconcilePlayerUi();
  }

  function cacheCountsText(cache: CacheProgress): string {
    const local = cache.localResult ? 1 : 0;
    const partial = cache.partialResult ? 1 : 0;
    const remote = cache.remoteResult ? 1 : 0;
    return `cache: local ${local}, partial ${partial}, remote ${remote}`;
  }

  function cachedPartsText(cache: CacheProgress): string {
    const total = cache.totalBatches ?? 0;
    return total > 0 ? `cached parts ${cache.cachedBatches}/${total}` : `cached parts ${cache.cachedBatches}`;
  }

  function cacheProgressPrefix(cache: CacheProgress, totalBatches?: number): string {
    const parts = totalBatches ?? cache.totalBatches;
    const partsText = parts ? `parts ${parts}` : "parts checking";
    return `${partsText} · ${cacheCountsText(cache)} · ${cachedPartsText(cache)}`;
  }

  function activePartPrefix(activeBatch: number | undefined, completedBatches: number | undefined, totalBatches: number | undefined, cache: CacheProgress | undefined): string | undefined {
    if (!totalBatches) {
      return undefined;
    }
    const currentPart = activeBatch ?? Math.min((completedBatches ?? 0) + 1, totalBatches);
    const cacheText = cache ? ` · ${cachedPartsText(cache)}` : "";
    return `Generating part ${currentPart}/${totalBatches}${cacheText}`;
  }

  function startClientRequest(videoId: string, requestSequence: number, startedMs: number, estimate: string | undefined): void {
    const request = deps.generationClient.start(videoId, {
      onProgress(progress) {
        if (isStale(requestSequence, videoId)) {
          return;
        }
        if (progress.cache) {
          activeGeneration = activeGeneration ? { ...activeGeneration, cache: progress.cache } : activeGeneration;
          activeGeneration = activeGeneration
            ? { ...activeGeneration, statusPrefix: cacheProgressPrefix(progress.cache, progress.totalBatches) }
            : activeGeneration;
        } else {
          const nextPrefix = activePartPrefix(progress.activeBatch, progress.completedBatches, progress.totalBatches, activeGeneration?.cache);
          activeGeneration = activeGeneration
            ? { ...activeGeneration, statusPrefix: nextPrefix ?? progress.message }
            : activeGeneration;
        }
        deps.ui.setProgress(statusMessage(startedMs, estimate));
      },
      onPartialResult(result, progress) {
        if (isStale(requestSequence, videoId)) {
          return;
        }
        deps.ui.setResult(result, "Learning subtitles streaming...");
        const cacheText = activeGeneration?.cache ? ` · ${cachedPartsText(activeGeneration.cache)}` : "";
        activeGeneration = activeGeneration
          ? { ...activeGeneration, statusPrefix: `Part ${progress.completedBatches}/${progress.totalBatches} ready${cacheText}` }
          : activeGeneration;
        deps.ui.setProgress(statusMessage(startedMs, estimate));
        deps.reconcilePlayerUi();
      },
      onResult(result, meta) {
        if (!isStale(requestSequence, videoId)) {
          if (meta?.mode === "partialFallback" || meta?.mode === "sourceFallback") {
            finishIncomplete(videoId, startedMs, result, meta);
            return;
          }
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
      deps.ui.setProgress(`Already generating this video · ${statusMessage(activeGeneration.startedMs, estimateGenerationDuration(deps.win))}`);
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
