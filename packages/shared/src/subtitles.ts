export type RawSubtitleCue = {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
};

function timeToMs(value: string): number | undefined {
  const normalized = value.trim().replace(",", ".");
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) {
    return undefined;
  }
  const [, hoursValue, minutesValue, secondsValue, millisecondsValue = "0"] = match;
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);
  const seconds = Number(secondsValue);
  const milliseconds = Number(millisecondsValue.padEnd(3, "0"));
  if (
    !Number.isSafeInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    !Number.isInteger(milliseconds)
  ) {
    return undefined;
  }
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + milliseconds;
}

export function parseSrt(content: string): RawSubtitleCue[] {
  const blocks = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split(/\n\n+/);
  const cues: RawSubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 3) {
      continue;
    }
    const id = Number(lines[0]);
    const [start, end] = lines[1]?.split(/\s+-->\s+/) ?? [];
    if (!Number.isInteger(id) || !start || !end) {
      continue;
    }
    const startMs = timeToMs(start);
    const endMs = timeToMs(end);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      continue;
    }
    cues.push({ id, startMs, endMs, text: lines.slice(2).join(" ") });
  }
  return cues;
}

export function parseVtt(content: string): RawSubtitleCue[] {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^WEBVTT.*\n/, "")
    .trim()
    .split(/\n\n+/);
  const cues: RawSubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }
    const [start, end] = lines[timingIndex]?.split(/\s+-->\s+/) ?? [];
    const textLines = lines.slice(timingIndex + 1);
    if (!start || !end || textLines.length === 0) {
      continue;
    }
    const startMs = timeToMs(start);
    const endMs = timeToMs(end.split(/\s+/)[0] ?? end);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      continue;
    }
    cues.push({
      id: cues.length + 1,
      startMs,
      endMs,
      text: textLines.join(" "),
    });
  }
  return cues;
}

export function findCueAtMs<T extends { startMs: number; endMs: number }>(cues: T[], currentMs: number): T | undefined {
  return cues.find((cue) => cue.startMs <= currentMs && currentMs < cue.endMs);
}
