export type GenerationHistoryRecord = {
  videoId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  status: "success" | "failed";
};

const GENERATION_HISTORY_KEY = "fluentFrame.generationHistory.v1";
const MAX_GENERATION_HISTORY = 20;

export function readGenerationHistory(win: Window): GenerationHistoryRecord[] {
  try {
    const raw = win.localStorage?.getItem(GENERATION_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is GenerationHistoryRecord => {
      return Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as GenerationHistoryRecord).videoId === "string" &&
          typeof (item as GenerationHistoryRecord).startedAt === "string" &&
          typeof (item as GenerationHistoryRecord).finishedAt === "string" &&
          typeof (item as GenerationHistoryRecord).elapsedMs === "number" &&
          ((item as GenerationHistoryRecord).status === "success" || (item as GenerationHistoryRecord).status === "failed"),
      );
    });
  } catch {
    return [];
  }
}

export function writeGenerationRecord(win: Window, record: GenerationHistoryRecord): void {
  try {
    const history = [record, ...readGenerationHistory(win)].slice(0, MAX_GENERATION_HISTORY);
    win.localStorage?.setItem(GENERATION_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Best-effort UX data; generation must not fail if storage is blocked.
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export function estimateGenerationDuration(win: Window): string | undefined {
  const successes = readGenerationHistory(win)
    .filter((record) => record.status === "success" && record.elapsedMs > 0)
    .slice(0, 10);
  if (successes.length === 0) {
    return undefined;
  }
  const averageMs = successes.reduce((sum, record) => sum + record.elapsedMs, 0) / successes.length;
  return formatDuration(averageMs);
}
