import { formatDuration } from "./generationHistory.js";

function generationStage(elapsedMs: number): string {
  if (elapsedMs < 4_000) {
    return "Checking cache and captions";
  }
  if (elapsedMs < 12_000) {
    return "Preparing caption batches";
  }
  if (elapsedMs < 90_000) {
    return "Generating local batches";
  }
  return "Still generating long-video batches";
}

export function generationProgressMessage(startedMs: number, estimate: string | undefined, nowMs = Date.now()): string {
  const elapsedMs = Math.max(0, nowMs - startedMs);
  const etaText = estimate ? `ETA about ${estimate}` : "ETA after first successful run";
  return `${generationStage(elapsedMs)} · elapsed ${formatDuration(elapsedMs)} · ${etaText}`;
}
