import { describe, expect, it } from "vitest";
import { parseHostRequest, parseHostResponse, parseRequestId, parsePersonalNotes, parseYoutubeVideoId } from "../src/protocol.js";

describe("parseYoutubeVideoId", () => {
  it("accepts normal YouTube IDs", () => {
    expect(parseYoutubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects unsafe IDs", () => {
    expect(() => parseYoutubeVideoId("../bad")).toThrow("Invalid YouTube video ID");
  });
});

describe("parseHostRequest", () => {
  it("parses a health check request", () => {
    expect(parseHostRequest({ id: "health1", type: "healthCheck" })).toEqual({
      id: "health1",
      type: "healthCheck",
    });
  });

  it("parses a processVideo request", () => {
    expect(
      parseHostRequest({
        id: "1",
        type: "processVideo",
        videoId: "dQw4w9WgXcQ",
        captionLanguage: "en",
      }),
    ).toEqual({
      id: "1",
      type: "processVideo",
      videoId: "dQw4w9WgXcQ",
      captionLanguage: "en",
    });
  });

  it("parses personal notes requests", () => {
    const note = {
      id: "dQw4w9WgXcQ:1:p1",
      videoId: "dQw4w9WgXcQ",
      cueId: 1,
      startMs: 1200,
      sentenceEnglish: "Nice pass.",
      sentenceChinese: "传得漂亮。",
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A good pass.",
      savedAt: "2026-07-19T00:00:00.000Z",
    };

    expect(parseHostRequest({ id: "notes1", type: "getPersonalNotes" })).toEqual({
      id: "notes1",
      type: "getPersonalNotes",
    });
    expect(parseHostRequest({ id: "notes2", type: "savePersonalNotes", notes: [note] })).toEqual({
      id: "notes2",
      type: "savePersonalNotes",
      notes: [note],
    });
  });

  it("rejects unknown message types", () => {
    expect(() => parseHostRequest({ id: "1", type: "shell", command: "rm -rf /" })).toThrow(
      "Unsupported host request type",
    );
  });
});

describe("parsePersonalNotes", () => {
  it("accepts valid notes", () => {
    expect(
      parsePersonalNotes([
        {
          id: "dQw4w9WgXcQ:1:p1",
          videoId: "dQw4w9WgXcQ",
          cueId: 1,
          startMs: 1200,
          sentenceEnglish: "Nice pass.",
          sentenceChinese: "传得漂亮。",
          phrase: "nice pass",
          meaningZh: "传得漂亮",
          explanationEn: "A good pass.",
          usageNotes: [
            {
              term: "sign",
              question: "Why use sign here?",
              explanation: "It means to close or finish.",
            },
          ],
          savedAt: "2026-07-19T00:00:00.000Z",
        },
      ]),
    ).toHaveLength(1);
  });

  it("rejects invalid note arrays", () => {
    expect(() => parsePersonalNotes([{ id: "../bad" }])).toThrow("Invalid personal notes");
    expect(() => parsePersonalNotes([
      {
        id: "dQw4w9WgXcQ:1:p1",
        videoId: "dQw4w9WgXcQ",
        cueId: 1,
        startMs: 1200,
        sentenceEnglish: "Nice pass.",
        sentenceChinese: "传得漂亮。",
        phrase: "nice pass",
        meaningZh: "传得漂亮",
        explanationEn: "A good pass.",
        usageNotes: [{ term: "sign" }],
        savedAt: "2026-07-19T00:00:00.000Z",
      },
    ])).toThrow("Invalid personal notes");
  });
});

describe("parseRequestId", () => {
  it("accepts safe request ID tokens", () => {
    expect(parseRequestId("1")).toBe("1");
    expect(parseRequestId("abc-123")).toBe("abc-123");
    expect(parseRequestId("1760000000000-550e8400-e29b-41d4-a716-446655440000")).toBe(
      "1760000000000-550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rejects spaces, newlines, and control characters", () => {
    expect(() => parseRequestId("abc 123")).toThrow("Invalid request ID");
    expect(() => parseRequestId("abc\n123")).toThrow("Invalid request ID");
    expect(() => parseRequestId("abc\u0000123")).toThrow("Invalid request ID");
  });
});

describe("parseHostResponse", () => {
  it("rejects learning subtitle results with invalid nested cue data", () => {
    expect(() => parseHostResponse("response1", {
      id: "response1",
      ok: true,
      type: "result",
      result: {
        videoId: "dQw4w9WgXcQ",
        sourceLanguage: "en",
        workflowVersion: "test",
        generatedAt: "2026-07-21T00:00:00.000Z",
        subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["missing"] }],
        phrases: [],
      },
    })).toThrow("Invalid native host response");
  });
});
