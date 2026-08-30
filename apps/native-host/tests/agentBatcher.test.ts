import { describe, expect, it } from "vitest";
import { createBatchedAgentRunner } from "../src/agentBatcher.js";
import type { LocalAgentAdapter } from "../src/localAgentAdapter.js";

function time(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `00:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")},000`;
}

function makeSrt(cueCount: number): string {
  return Array.from({ length: cueCount }, (_, index) => {
    const id = index + 1;
    return `${id}\n${time(index)} --> ${time(index + 1)}\nLine ${id}.`;
  }).join("\n\n");
}

describe("createBatchedAgentRunner", () => {
  it("retries a transient failed batch before failing long caption processing", async () => {
    const processedCueIds: number[] = [];
    const completedBatches: number[] = [];
    const attemptsByCueId = new Map<number, number>();
    const adapter: LocalAgentAdapter = {
      name: "codex",
      async runPreparedBatch(batch) {
        const ids = [...batch.prompt.matchAll(/\n(\d+)\n\d{2}:\d{2}:\d{2},\d{3} -->/g)].map((match) => Number(match[1]));
        const cueId = ids[0]!;
        processedCueIds.push(cueId);
        const attempts = (attemptsByCueId.get(cueId) ?? 0) + 1;
        attemptsByCueId.set(cueId, attempts);
        if (cueId === 21 && attempts === 1) {
          throw new Error("Codex timed out after 300 seconds");
        }
        return {
          subtitles: [{ id: cueId, startMs: 0, endMs: 1000, english: `Line ${cueId}.`, chinese: `第${cueId}句。`, phraseIds: [`p${cueId}`] }],
          phrases: [
            {
              id: `p${cueId}`,
              cueId,
              phrase: `line ${cueId}`,
              meaningZh: `第${cueId}句`,
              explanationEn: "A retried sentence.",
              difficulty: "basic",
            },
          ],
        };
      },
    };
    const runAgent = createBatchedAgentRunner(adapter, "Prompt");

    const output = await runAgent(makeSrt(45), {
      onBatch(progress) {
        completedBatches.push(progress.completedBatches);
      },
    });

    expect(processedCueIds).toEqual([1, 21, 21, 41]);
    expect(completedBatches).toEqual([1, 2, 3]);
    expect(output.subtitles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 21, chinese: "第21句。" }),
      expect.objectContaining({ id: 41, chinese: "第41句。" }),
    ]));
  });

  it("resumes long caption processing from the next unfinished batch", async () => {
    const processedCueIds: number[] = [];
    const adapter: LocalAgentAdapter = {
      name: "codex",
      async runPreparedBatch(batch) {
        const ids = [...batch.prompt.matchAll(/\n(\d+)\n\d{2}:\d{2}:\d{2},\d{3} -->/g)].map((match) => Number(match[1]));
        const cueId = ids[0]!;
        processedCueIds.push(cueId);
        return {
          subtitles: [{ id: cueId, startMs: 0, endMs: 1000, english: `Line ${cueId}.`, chinese: `第${cueId}句。`, phraseIds: [`p${cueId}`] }],
          phrases: [
            {
              id: `p${cueId}`,
              cueId,
              phrase: `line ${cueId}`,
              meaningZh: `第${cueId}句`,
              explanationEn: "A resumed sentence.",
              difficulty: "basic",
            },
          ],
        };
      },
    };
    const runAgent = createBatchedAgentRunner(adapter, "Prompt");

    const output = await runAgent(makeSrt(45), {
      resumeFrom: {
        completedBatches: 1,
        totalBatches: 3,
        output: {
          subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Line 1.", chinese: "第1句。", phraseIds: ["p1"] }],
          phrases: [
            {
              id: "p1",
              cueId: 1,
              phrase: "line 1",
              meaningZh: "第1句",
              explanationEn: "A completed sentence.",
              difficulty: "basic",
            },
          ],
        },
      },
    });

    expect(processedCueIds).toEqual([21, 41]);
    expect(output.subtitles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, chinese: "第1句。" }),
      expect.objectContaining({ id: 21, chinese: "第21句。" }),
      expect.objectContaining({ id: 41, chinese: "第41句。" }),
    ]));
  });
});
