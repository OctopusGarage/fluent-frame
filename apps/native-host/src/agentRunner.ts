import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSrt, type AgentName, type PhraseExplanation, type RawSubtitleCue, type SubtitleCue } from "@fluent-frame/shared";
import { assertAgentOutput } from "./resultValidation.js";

export type AgentOutput = {
  subtitles: SubtitleCue[];
  phrases: PhraseExplanation[];
};

export type AgentBatchProgress = {
  output: AgentOutput;
  completedBatches: number;
  totalBatches: number;
};

export type AgentRunnerOptions = {
  onBatch?: (progress: AgentBatchProgress) => Promise<void> | void;
};

export type AgentRunner = (captionText: string, options?: AgentRunnerOptions) => Promise<AgentOutput>;

const MAX_CUES_PER_AGENT_BATCH = 20;
const AGENT_TIMEOUT_MS = 120_000;

async function existingPromptPath(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "prompts", "youtube-learning-subtitles.md"),
    join(process.cwd(), "apps", "native-host", "prompts", "youtube-learning-subtitles.md"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next build layout.
    }
  }
  throw new Error("Prompt template not found");
}

function runAgentProcess(
  executablePath: string,
  args: string[],
  prompt: string,
  options: {
    cwd: string;
    displayName: string;
    stdioMode: "output-file" | "stdout-json";
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(executablePath, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${options.displayName} timed out after ${Math.round(AGENT_TIMEOUT_MS / 1000)} seconds`));
    }, AGENT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error.code === "ENOENT" ? new Error(`${options.displayName} CLI not found at ${executablePath}`) : error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve(options.stdioMode === "stdout-json" ? stdout : "");
      } else {
        reject(new Error(stderr.trim() || `${options.displayName.toLowerCase()} exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
}

function runCodex(codexPath: string, prompt: string, cwd: string, outputPath: string): Promise<void> {
  return runAgentProcess(
    codexPath,
    [
      "exec",
      "--json",
      "--output-last-message",
      outputPath,
      "--cd",
      cwd,
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--ignore-rules",
    ],
    prompt,
    { cwd, displayName: "Codex", stdioMode: "output-file" },
  ).then(() => undefined);
}

async function runClaude(claudePath: string, prompt: string, cwd: string): Promise<unknown> {
  const stdout = await runAgentProcess(
    claudePath,
    ["--print", "--output-format", "json", "--permission-mode", "dontAsk", "--no-session-persistence"],
    prompt,
    { cwd, displayName: "Claude", stdioMode: "stdout-json" },
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (parsed && typeof parsed === "object" && typeof (parsed as { result?: unknown }).result === "string") {
    return JSON.parse((parsed as { result: string }).result) as unknown;
  }
  return parsed;
}

function msToSrtTime(value: number): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const milliseconds = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function formatCue(cue: RawSubtitleCue): string {
  return `${cue.id}
${msToSrtTime(cue.startMs)} --> ${msToSrtTime(cue.endMs)}
${cue.text}`;
}

function prepareCaptionBatches(captionText: string): string[] {
  const cues = parseSrt(captionText);
  if (cues.length <= MAX_CUES_PER_AGENT_BATCH) {
    return [captionText];
  }

  const batches: string[] = [];
  for (let index = 0; index < cues.length; index += MAX_CUES_PER_AGENT_BATCH) {
    const batch = cues.slice(index, index + MAX_CUES_PER_AGENT_BATCH);
    const batchNumber = Math.floor(index / MAX_CUES_PER_AGENT_BATCH) + 1;
    const batchCount = Math.ceil(cues.length / MAX_CUES_PER_AGENT_BATCH);
    const formattedBatch = batch.map(formatCue).join("\n\n");
    batches.push(
      `NOTE: The source caption file is long. Process this ${MAX_CUES_PER_AGENT_BATCH}-cue batch ${batchNumber} of ${batchCount} only. Preserve these cue IDs and timings exactly.\n\n${formattedBatch}\n`,
    );
  }
  return batches;
}

function uniquePhraseId(preferredId: string, cueId: number, usedIds: Set<string>): string {
  if (!usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }
  const base = `${preferredId}-${cueId}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function mergeAgentOutputs(outputs: AgentOutput[]): AgentOutput {
  if (outputs.length === 1) {
    return outputs[0]!;
  }

  const usedPhraseIds = new Set<string>();
  const subtitles: SubtitleCue[] = [];
  const phrases: PhraseExplanation[] = [];

  for (const output of outputs) {
    const phraseIdMap = new Map<string, string>();
    for (const phrase of output.phrases) {
      const nextId = uniquePhraseId(phrase.id, phrase.cueId, usedPhraseIds);
      phraseIdMap.set(phrase.id, nextId);
      phrases.push({ ...phrase, id: nextId });
    }
    for (const subtitle of output.subtitles) {
      subtitles.push({
        ...subtitle,
        phraseIds: subtitle.phraseIds.map((phraseId) => phraseIdMap.get(phraseId) ?? phraseId),
      });
    }
  }

  return {
    subtitles: subtitles.sort((left, right) => left.id - right.id),
    phrases: phrases.sort((left, right) => left.cueId - right.cueId),
  };
}

async function runAgentOverCaptionBatches(
  captionText: string,
  runBatch: (preparedCaptionText: string) => Promise<AgentOutput>,
  options: AgentRunnerOptions = {},
): Promise<AgentOutput> {
  const batches = prepareCaptionBatches(captionText);
  if (batches.length === 1) {
    const output = await runBatch(batches[0]!);
    await options.onBatch?.({ output, completedBatches: 1, totalBatches: 1 });
    return output;
  }

  const outputs: AgentOutput[] = [];
  for (const batch of batches) {
    outputs.push(await runBatch(batch));
    const merged = mergeAgentOutputs(outputs);
    assertAgentOutput(merged);
    await options.onBatch?.({ output: merged, completedBatches: outputs.length, totalBatches: batches.length });
  }
  const merged = mergeAgentOutputs(outputs);
  assertAgentOutput(merged);
  return merged;
}

function buildPrompt(promptTemplate: string, preparedCaptionText: string, instruction = ""): string {
  if (instruction) {
    return `${promptTemplate}\n\n${instruction}\n\n<SRT_INPUT>\n${preparedCaptionText}\n</SRT_INPUT>\n`;
  }
  return `${promptTemplate}\n\n<SRT_INPUT>\n${preparedCaptionText}\n</SRT_INPUT>\n`;
}

function parseCodexOutput(raw: string): AgentOutput {
  const parsed = JSON.parse(raw) as unknown;
  assertAgentOutput(parsed);
  return parsed;
}

function parseClaudeOutput(parsed: unknown): AgentOutput {
  assertAgentOutput(parsed);
  return parsed;
}

function parseAgentError(error: unknown): never {
  if (error instanceof SyntaxError) {
    throw new Error("Invalid agent output");
  }
  throw error;
}

export async function createCodexRunner(codexPath: string): Promise<AgentRunner> {
  const promptPath = await existingPromptPath();
  const promptTemplate = await readFile(promptPath, "utf8");
  return async (captionText: string, options?: AgentRunnerOptions) => {
    return runAgentOverCaptionBatches(captionText, async (preparedCaptionText) => {
      const dir = await mkdtemp(join(tmpdir(), "ff-codex-"));
      const outputPath = join(dir, "last-message.json");
      const prompt = buildPrompt(promptTemplate, preparedCaptionText);
      try {
        await runCodex(codexPath, prompt, dir, outputPath);
        return parseCodexOutput(await readFile(outputPath, "utf8"));
      } catch (error) {
        parseAgentError(error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, options);
  };
}

export async function createClaudeRunner(claudePath: string): Promise<AgentRunner> {
  const promptPath = await existingPromptPath();
  const promptTemplate = await readFile(promptPath, "utf8");
  return async (captionText: string, options?: AgentRunnerOptions) => {
    return runAgentOverCaptionBatches(captionText, async (preparedCaptionText) => {
      const dir = await mkdtemp(join(tmpdir(), "ff-claude-"));
      const prompt = buildPrompt(promptTemplate, preparedCaptionText, "Return only the final JSON object in your result text.");
      try {
        const parsed = await runClaude(claudePath, prompt, dir);
        return parseClaudeOutput(parsed);
      } catch (error) {
        parseAgentError(error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, options);
  };
}

export async function createConfiguredRunner(agent: AgentName, paths: { codexPath: string; claudePath: string }): Promise<AgentRunner> {
  return agent === "claude" ? createClaudeRunner(paths.claudePath) : createCodexRunner(paths.codexPath);
}
