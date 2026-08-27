import type { LearningSubtitleResult, PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";

export const VISIBLE_SENTENCE_COUNT = 5;

export type CaptionWindow = {
  activeCue: SubtitleCue | undefined;
  cues: SubtitleCue[];
};

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function findActiveCueIndex(cues: SubtitleCue[], currentMs: number): number {
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index];
    if (cue && cue.startMs <= currentMs && currentMs < cue.endMs) {
      return index;
    }
  }
  return -1;
}

export function findCueWindow(cues: SubtitleCue[], activeIndex: number): SubtitleCue[] {
  if (activeIndex < 0) {
    return [];
  }
  const activeCue = cues[activeIndex];
  if (!activeCue) {
    return [];
  }
  const windowStart = Math.max(0, Math.min(activeIndex, cues.length - VISIBLE_SENTENCE_COUNT));
  const window = cues.slice(windowStart, windowStart + VISIBLE_SENTENCE_COUNT);
  while (window.length < VISIBLE_SENTENCE_COUNT && windowStart - (VISIBLE_SENTENCE_COUNT - window.length) >= 0) {
    const previousCue = cues[windowStart - (VISIBLE_SENTENCE_COUNT - window.length)];
    if (previousCue) {
      window.unshift(previousCue);
    } else {
      break;
    }
  }
  return window;
}

export function selectCaptionWindow(cues: SubtitleCue[], currentMs: number): CaptionWindow {
  const activeIndex = findActiveCueIndex(cues, currentMs);
  return {
    activeCue: activeIndex >= 0 ? cues[activeIndex] : undefined,
    cues: findCueWindow(cues, activeIndex),
  };
}

export function selectLearningEventWindow(result: LearningSubtitleResult | undefined, currentMs: number): PhraseExplanation[] {
  if (!result || result.phrases.length === 0) {
    return [];
  }
  const cueById = new Map(result.subtitles.map((subtitle) => [subtitle.id, subtitle]));
  const events = result.phrases
    .map((phrase) => ({ phrase, cue: cueById.get(phrase.cueId) }))
    .filter((event): event is { phrase: PhraseExplanation; cue: SubtitleCue } => Boolean(event.cue))
    .sort((left, right) => left.cue.startMs - right.cue.startMs);
  if (events.length === 0) {
    return [];
  }
  const activeIndex = findActiveCueIndex(result.subtitles, currentMs);
  const anchorMs = activeIndex >= 0 ? result.subtitles[activeIndex]?.startMs ?? currentMs : currentMs;
  const upcoming = events.filter((event) => event.cue.endMs > anchorMs);
  const window = upcoming.length > 0
    ? upcoming.slice(0, VISIBLE_SENTENCE_COUNT)
    : events.slice(Math.max(0, events.length - VISIBLE_SENTENCE_COUNT));
  return window.map((event) => event.phrase);
}
