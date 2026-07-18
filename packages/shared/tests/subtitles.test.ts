import { describe, expect, it } from "vitest";
import { findCueAtMs, parseSrt, parseVtt } from "../src/subtitles.js";

describe("parseSrt", () => {
  it("parses SRT cues into milliseconds", () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:02,500
Hello there.

2
00:00:03,000 --> 00:00:04,000
from downtown
`);
    expect(cues).toEqual([
      { id: 1, startMs: 1000, endMs: 2500, text: "Hello there." },
      { id: 2, startMs: 3000, endMs: 4000, text: "from downtown" },
    ]);
  });

  it("skips cues with invalid timestamps or ranges", () => {
    const cues = parseSrt(`1
00:00:01,000 --> 00:00:02,000
Valid SRT.

2
bad --> 00:00:04,000
Malformed timestamp.

3
00:00:05,000 --> 00:00:NaN,000
NaN timestamp.

4
00:00:10,000 --> 00:00:09,000
Backwards range.

5
00:61:00,000 --> 00:62:00,000
Out of range.
`);

    expect(cues).toEqual([{ id: 1, startMs: 1000, endMs: 2000, text: "Valid SRT." }]);
  });
});

describe("parseVtt", () => {
  it("parses WEBVTT cues", () => {
    const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
Nice pass.
`);
    expect(cues).toEqual([{ id: 1, startMs: 1000, endMs: 2000, text: "Nice pass." }]);
  });

  it("skips cues with invalid timestamps or ranges", () => {
    const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
Valid VTT.

bad --> 00:00:04.000
Malformed timestamp.

00:00:05.000 --> 00:00:NaN.000
NaN timestamp.

00:00:10.000 --> 00:00:09.000
Backwards range.

00:61:00.000 --> 00:62:00.000
Out of range.
`);

    expect(cues).toEqual([{ id: 1, startMs: 1000, endMs: 2000, text: "Valid VTT." }]);
  });
});

describe("findCueAtMs", () => {
  it("returns the active cue", () => {
    const cue = findCueAtMs([{ id: 1, startMs: 100, endMs: 200, text: "A" }], 150);
    expect(cue?.text).toBe("A");
  });
});
