import { describe, expect, it } from "vitest";
import { assertAgentOutput, isValidAgentOutput } from "../src/resultValidation.js";

const validAgentOutput = {
  subtitles: [
    {
      id: 1,
      startMs: 0,
      endMs: 1000,
      english: "Nice pass.",
      chinese: "传得漂亮。",
      phraseIds: ["p1"],
    },
  ],
  phrases: [
    {
      id: "p1",
      cueId: 1,
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
      difficulty: "basic",
    },
  ],
};

describe("agent output validation", () => {
  it("accepts valid subtitle and phrase output from local agents", () => {
    expect(isValidAgentOutput(validAgentOutput)).toBe(true);
    expect(() => assertAgentOutput(validAgentOutput)).not.toThrow();
  });

  it("rejects empty agent output", () => {
    expect(isValidAgentOutput({ subtitles: [], phrases: [] })).toBe(false);
    expect(() => assertAgentOutput({ subtitles: [], phrases: [] })).toThrow("Invalid agent output");
  });

  it("rejects invalid phrase difficulty labels", () => {
    expect(
      isValidAgentOutput({
        ...validAgentOutput,
        phrases: [{ ...validAgentOutput.phrases[0]!, difficulty: "expert" }],
      }),
    ).toBe(false);
  });

  it("rejects broken subtitle and phrase references", () => {
    expect(
      isValidAgentOutput({
        ...validAgentOutput,
        subtitles: [{ ...validAgentOutput.subtitles[0]!, phraseIds: ["missing"] }],
      }),
    ).toBe(false);

    expect(
      isValidAgentOutput({
        ...validAgentOutput,
        phrases: [{ ...validAgentOutput.phrases[0]!, cueId: 2 }],
      }),
    ).toBe(false);
  });
});
