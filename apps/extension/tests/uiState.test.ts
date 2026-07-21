import type { LearningSubtitleResult } from "@fluent-frame/shared";
import { describe, expect, it } from "vitest";
import { selectCaptionWindow, selectLearningEventWindow } from "../src/uiState.js";

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: "test",
  generatedAt: "2026-07-21T00:00:00.000Z",
  subtitles: [
    { id: 1, startMs: 0, endMs: 1000, english: "One.", chinese: "一。", phraseIds: ["p1"] },
    { id: 2, startMs: 1000, endMs: 2000, english: "Two.", chinese: "二。", phraseIds: ["p2"] },
    { id: 3, startMs: 2000, endMs: 3000, english: "Three.", chinese: "三。", phraseIds: ["p3"] },
    { id: 4, startMs: 3000, endMs: 4000, english: "Four.", chinese: "四。", phraseIds: ["p4"] },
  ],
  phrases: [
    { id: "p1", cueId: 1, phrase: "one", meaningZh: "第一句", explanationEn: "Opening idea.", difficulty: "basic" },
    { id: "p2", cueId: 2, phrase: "two", meaningZh: "第二句", explanationEn: "Follow-up idea.", difficulty: "basic" },
    { id: "p3", cueId: 3, phrase: "three", meaningZh: "第三句", explanationEn: "Current idea.", difficulty: "basic" },
    { id: "p4", cueId: 4, phrase: "four", meaningZh: "第四句", explanationEn: "Upcoming idea.", difficulty: "basic" },
  ],
};

describe("ui state selectors", () => {
  it("keeps one active subtitle cue and a stable three-cue display window", () => {
    expect(selectCaptionWindow(result.subtitles, 2500)).toEqual({
      activeCue: result.subtitles[2],
      cues: [result.subtitles[1], result.subtitles[2], result.subtitles[3]],
    });
  });

  it("selects upcoming learning events from the current playback position", () => {
    expect(selectLearningEventWindow(result, 2500).map((phrase) => phrase.id)).toEqual(["p3", "p4"]);
  });
});
