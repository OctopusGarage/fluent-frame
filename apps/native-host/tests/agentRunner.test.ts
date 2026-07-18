import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodexRunner } from "../src/agentRunner.js";

let dir = "";

async function writeExecutable(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-agent-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createCodexRunner", () => {
  it("parses JSON from the final message output file", async () => {
    const codexPath = await writeExecutable(
      "fake-codex.mjs",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
for (const required of ["exec", "--json", "--output-last-message", "--cd", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-rules"]) {
  if (!args.includes(required)) {
    console.error("missing " + required);
    process.exit(2);
  }
}
if (args.includes("--ignore-user-config")) {
  console.error("unexpected --ignore-user-config");
  process.exit(2);
}
const outputPath = args[args.indexOf("--output-last-message") + 1];
writeFileSync(outputPath, JSON.stringify({
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }]
}));
console.log(JSON.stringify({ type: "event", message: "not the result" }));
`,
    );

    const runAgent = await createCodexRunner(codexPath);

    await expect(runAgent("1\\n00:00:00,000 --> 00:00:01,000\\nNice pass.\\n")).resolves.toEqual({
      subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
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
    });
  });

  it("rejects invalid final message output", async () => {
    const codexPath = await writeExecutable(
      "invalid-codex.mjs",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
for (const required of ["exec", "--json", "--output-last-message", "--cd", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-rules"]) {
  if (!args.includes(required)) {
    console.error("missing " + required);
    process.exit(2);
  }
}
const outputPath = args[args.indexOf("--output-last-message") + 1];
writeFileSync(outputPath, JSON.stringify({
  subtitles: [{ id: 1, startMs: 0, endMs: 1000, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "impossible" }]
}));
`,
    );

    const runAgent = await createCodexRunner(codexPath);

    await expect(runAgent("captions")).rejects.toThrow("Invalid agent output");
  });

  it("reports when the Codex CLI is missing", async () => {
    const codexPath = join(dir, "missing-codex");
    const runAgent = await createCodexRunner(codexPath);

    await expect(runAgent("captions")).rejects.toThrow(`Codex CLI not found at ${codexPath}`);
  });

  it("rejects empty subtitle and phrase output", async () => {
    const codexPath = await writeExecutable(
      "empty-output-codex.mjs",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("--output-last-message") + 1];
writeFileSync(outputPath, JSON.stringify({ subtitles: [], phrases: [] }));
`,
    );
    const runAgent = await createCodexRunner(codexPath);

    await expect(runAgent("captions")).rejects.toThrow("Invalid agent output");
  });

  it("does not block live generation on quality-eval failures", async () => {
    const codexPath = await writeExecutable(
      "bad-quality-codex.mjs",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("--output-last-message") + 1];
writeFileSync(outputPath, JSON.stringify({
  subtitles: [{ id: 1, startMs: 0, endMs: 1400, english: "Nice pass.", chinese: "传得漂亮。", phraseIds: ["p1"] }],
  phrases: [{ id: "p1", cueId: 1, phrase: "nice pass", meaningZh: "传得漂亮", explanationEn: "A good pass.", difficulty: "basic" }]
}));
`,
    );
    const runAgent = await createCodexRunner(codexPath);

    await expect(runAgent(`1
00:00:00,000 --> 00:00:01,000
Nice pass.
`)).resolves.toMatchObject({
      subtitles: [{ id: 1, endMs: 1400, english: "Nice pass." }],
    });
  });

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

  it("sends a bounded AI excerpt for normal-length YouTube subtitle files", async () => {
    const promptLogPath = join(dir, "normal-length-prompts.log");
    const codexPath = await writeExecutable(
      "normal-length-codex.mjs",
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("--output-last-message") + 1];
let prompt = "";
process.stdin.on("data", (chunk) => {
  prompt += String(chunk);
});
process.stdin.on("end", () => {
  appendFileSync(${JSON.stringify(promptLogPath)}, prompt + "\\n---PROMPT---\\n");
  if (!prompt.includes("first 40-cue excerpt") || !prompt.includes("\\n40\\n") || prompt.includes("\\n41\\n")) {
    process.exit(2);
  }
  const cueId = 1;
  writeFileSync(outputPath, JSON.stringify({
    subtitles: [{ id: cueId, startMs: 0, endMs: 1000, english: "Line " + cueId + ".", chinese: "第" + cueId + "句。", phraseIds: ["p" + cueId] }],
    phrases: [{ id: "p" + cueId, cueId, phrase: "line " + cueId, meaningZh: "第" + cueId + "句", explanationEn: "A later sentence.", difficulty: "basic" }]
  }));
});
`,
    );
    const runAgent = await createCodexRunner(codexPath);

    const output = await runAgent(makeSrt(130));
    expect(output.subtitles).toEqual([
      expect.objectContaining({ id: 1, english: "Line 1." }),
    ]);
    await expect(readFile(promptLogPath, "utf8")).resolves.not.toContain("\n130\n");
  });

  it("sends a bounded excerpt for very large SRT input", async () => {
    const promptLogPath = join(dir, "excerpt-prompts.log");
    const codexPath = await writeExecutable(
      "excerpt-codex.mjs",
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const outputPath = args[args.indexOf("--output-last-message") + 1];
let prompt = "";
process.stdin.on("data", (chunk) => {
  prompt += String(chunk);
});
process.stdin.on("end", () => {
  appendFileSync(${JSON.stringify(promptLogPath)}, prompt + "\\n---PROMPT---\\n");
  if (!prompt.includes("first 40-cue excerpt") || !prompt.includes("\\n40\\n") || prompt.includes("\\n41\\n")) {
    process.exit(2);
  }
  const cueMatch = prompt.match(/\\n(\\d+)\\n\\d{2}:\\d{2}:\\d{2},\\d{3} -->/);
  const cueId = cueMatch ? Number(cueMatch[1]) : 1;
  writeFileSync(outputPath, JSON.stringify({
    subtitles: [{ id: cueId, startMs: 0, endMs: 1000, english: "Line " + cueId + ".", chinese: "第" + cueId + "句。", phraseIds: ["p" + cueId] }],
    phrases: [{ id: "p" + cueId, cueId, phrase: "line " + cueId, meaningZh: "第" + cueId + "句", explanationEn: "The first sentence.", difficulty: "basic" }]
  }));
});
`,
    );
    const runAgent = await createCodexRunner(codexPath);

    const output = await runAgent(makeSrt(520));
    expect(output.subtitles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, english: "Line 1." }),
    ]));
    await expect(readFile(promptLogPath, "utf8")).resolves.toContain("\n40\n");
    await expect(readFile(promptLogPath, "utf8")).resolves.not.toContain("\n41\n");
  });
});
