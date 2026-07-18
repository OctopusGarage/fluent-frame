import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSrt, type PhraseExplanation, type RawSubtitleCue, type SubtitleCue } from "@fluent-frame/shared";
import { assertAgentOutput } from "./resultValidation.js";

export type AgentOutput = {
  subtitles: SubtitleCue[];
  phrases: PhraseExplanation[];
};

export type AgentRunner = (captionText: string) => Promise<AgentOutput>;

const MAX_AGENT_CUES = 40;
const CODEX_TIMEOUT_MS = 120_000;

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

function runCodex(codexPath: string, prompt: string, cwd: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
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
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Codex timed out after ${Math.round(CODEX_TIMEOUT_MS / 1000)} seconds`));
    }, CODEX_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error.code === "ENOENT" ? new Error(`Codex CLI not found at ${codexPath}`) : error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `codex exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });
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

function prepareCaptionText(captionText: string): string {
  const cues = parseSrt(captionText);
  if (cues.length <= MAX_AGENT_CUES) {
    return captionText;
  }
  const excerpt = cues.slice(0, MAX_AGENT_CUES).map(formatCue).join("\n\n");
  return `NOTE: The source caption file is long. Process this first ${MAX_AGENT_CUES}-cue excerpt only. Preserve these cue IDs and timings exactly.\n\n${excerpt}\n`;
}

export async function createCodexRunner(codexPath: string): Promise<AgentRunner> {
  const promptPath = await existingPromptPath();
  const promptTemplate = await readFile(promptPath, "utf8");
  return async (captionText: string) => {
    const dir = await mkdtemp(join(tmpdir(), "ff-codex-"));
    const outputPath = join(dir, "last-message.json");
    const preparedCaptionText = prepareCaptionText(captionText);
    const prompt = `${promptTemplate}\n\n<SRT_INPUT>\n${preparedCaptionText}\n</SRT_INPUT>\n`;
    try {
      await runCodex(codexPath, prompt, dir, outputPath);
      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      assertAgentOutput(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Invalid agent output");
      }
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
