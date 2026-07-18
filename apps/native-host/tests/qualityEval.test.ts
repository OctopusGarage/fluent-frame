import { describe, expect, it } from "vitest";
import type { AgentOutput } from "../src/agentRunner.js";
import { evaluateAgentOutputQuality } from "../src/qualityEval.js";

const sourceCues = [
  { id: 1, startMs: 0, endMs: 2000, text: "Today I gonna show you how to pick up the main idea." },
  { id: 2, startMs: 2000, endMs: 4000, text: "You don't need catch every single word." },
];

const goodOutput: AgentOutput = {
  subtitles: [
    {
      id: 1,
      startMs: 0,
      endMs: 2000,
      english: "Today I am going to show you how to pick up the main idea.",
      chinese: "今天我会教你如何抓住主要意思。",
      phraseIds: ["p1"],
    },
    {
      id: 2,
      startMs: 2000,
      endMs: 4000,
      english: "You don't need to catch every single word.",
      chinese: "你不需要听懂每一个单词。",
      phraseIds: ["p2"],
    },
  ],
  phrases: [
    {
      id: "p1",
      cueId: 1,
      phrase: "pick up",
      meaningZh: "理解；学会",
      explanationEn: "To learn or understand something from context.",
      difficulty: "useful",
    },
    {
      id: "p2",
      cueId: 2,
      phrase: "catch every single word",
      meaningZh: "听懂每一个词",
      explanationEn: "To hear and understand all the words.",
      difficulty: "basic",
    },
  ],
};

describe("evaluateAgentOutputQuality", () => {
  it("accepts corrected bilingual output that preserves source cue timing", () => {
    expect(evaluateAgentOutputQuality(sourceCues, goodOutput)).toEqual([]);
  });

  it("rejects changed cue timing and missing Chinese translation", () => {
    const failures = evaluateAgentOutputQuality(sourceCues, {
      ...goodOutput,
      subtitles: [
        { ...goodOutput.subtitles[0]!, endMs: 2300, chinese: "No Chinese here" },
        goodOutput.subtitles[1]!,
      ],
    });

    expect(failures).toContain("Subtitle 1 changed source timing");
    expect(failures).toContain("Subtitle 1 is missing Chinese translation");
  });

  it("rejects phrase IDs that are not referenced both ways", () => {
    const failures = evaluateAgentOutputQuality(sourceCues, {
      ...goodOutput,
      subtitles: [{ ...goodOutput.subtitles[0]!, phraseIds: [] }, goodOutput.subtitles[1]!],
    });

    expect(failures).toContain("Subtitle 1 has no phrase IDs");
    expect(failures).toContain("Phrase p1 is not referenced by any subtitle");
  });

  it("rejects obvious uncorrected learner grammar from the source", () => {
    const failures = evaluateAgentOutputQuality(sourceCues, {
      ...goodOutput,
      subtitles: [
        { ...goodOutput.subtitles[0]!, english: "Today I gonna show you how to pick up the main idea." },
        { ...goodOutput.subtitles[1]!, english: "You don't need catch every single word." },
      ],
    });

    expect(failures).toContain("English correction left the obvious error 'I gonna'");
    expect(failures).toContain("English correction left the obvious error 'need catch'");
  });
});
