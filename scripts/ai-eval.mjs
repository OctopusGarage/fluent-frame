#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseSrt } from "../packages/shared/dist/subtitles.js";
import { assertAgentOutput } from "../apps/native-host/dist/resultValidation.js";
import { evaluateAgentOutputQuality } from "../apps/native-host/dist/qualityEval.js";

const sampleSrt = `1
00:00:00,000 --> 00:00:02,000
Today I gonna show you how to pick up the main idea.

2
00:00:02,000 --> 00:00:04,000
You don't need catch every single word.
`;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
    if (options.stdin) {
      child.stdin.end(options.stdin);
    }
  });
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertEvalOutput(value) {
  const failures = [];
  try {
    assertAgentOutput(value);
  } catch {
    return ["Output is not a JSON object"];
  }
  if (!Array.isArray(value.subtitles) || value.subtitles.length !== 2) {
    failures.push("Expected exactly two subtitle objects");
  }
  if (!Array.isArray(value.phrases) || value.phrases.length < 2) {
    failures.push("Expected at least two phrase explanations");
  }
  return [...failures, ...evaluateAgentOutputQuality(parseSrt(sampleSrt), value)];
}

async function main() {
  const codexPath = process.env.FF_CODEX_PATH ?? "codex";
  const promptPath = resolve("apps/native-host/prompts/youtube-learning-subtitles.md");
  if (!(await fileExists(promptPath))) {
    throw new Error(`Prompt template not found at ${promptPath}`);
  }

  const promptTemplate = await readFile(promptPath, "utf8");
  const workDir = await mkdtemp(join(tmpdir(), "ff-ai-eval-"));
  const outputPath = join(workDir, "last-message.json");
  const prompt = `${promptTemplate}

This is an eval. Return JSON only. Preserve exactly two cues and timings.

<SRT_INPUT>
${sampleSrt}
</SRT_INPUT>
`;

  try {
    await run(
      codexPath,
      [
        "exec",
        "--json",
        "--output-last-message",
        outputPath,
        "--cd",
        workDir,
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-rules",
      ],
      { stdin: prompt },
    );

    const rawOutput = await readFile(outputPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      throw new Error(`Codex did not return valid JSON:\n${rawOutput}`);
    }

    const failures = assertEvalOutput(parsed);
    if (failures.length > 0) {
      throw new Error(`AI eval failed:\n- ${failures.join("\n- ")}\n\nOutput:\n${JSON.stringify(parsed, null, 2)}`);
    }

    console.log("AI eval passed");
    console.log(`Subtitles: ${parsed.subtitles.length}`);
    console.log(`Phrases: ${parsed.phrases.length}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
