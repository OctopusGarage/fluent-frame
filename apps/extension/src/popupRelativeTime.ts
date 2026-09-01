export type PopupRelativeTimeMaxUnit = "minutes" | "hours";

export function formatPopupRelativeTime(
  timestamp: string,
  options: { maxUnit?: PopupRelativeTimeMaxUnit } = {},
): string {
  const elapsedMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "just now";
  }

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  if (options.maxUnit === "minutes" || elapsedSeconds < 3600) {
    return `${Math.floor(elapsedSeconds / 60)}m ago`;
  }
  return `${Math.floor(elapsedSeconds / 3600)}h ago`;
}
