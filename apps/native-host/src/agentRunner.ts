import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAgentOutput, type AgentName } from "@fluent-frame/shared";
import { createBatchedAgentRunner } from "./agentBatcher.js";
import type { AgentOutput, AgentRunner, AgentRunnerOptions } from "./agentTypes.js";
import type { LocalAgentAdapter } from "./localAgentAdapter.js";
import { runClaude, runCodex } from "./localAgentProcess.js";
export type { AgentOutput, AgentBatchProgress, AgentRunnerOptions, AgentRunner } from "./agentTypes.js";

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
  const adapter: LocalAgentAdapter = {
    name: "codex",
    async runPreparedBatch(batch) {
      const dir = await mkdtemp(join(tmpdir(), "ff-codex-"));
      const outputPath = join(dir, "last-message.json");
      try {
        await runCodex(codexPath, batch.prompt, dir, outputPath);
        return parseCodexOutput(await readFile(outputPath, "utf8"));
      } catch (error) {
        parseAgentError(error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
  return createBatchedAgentRunner(adapter, promptTemplate);
}

export async function createClaudeRunner(claudePath: string): Promise<AgentRunner> {
  const promptPath = await existingPromptPath();
  const promptTemplate = await readFile(promptPath, "utf8");
  const adapter: LocalAgentAdapter = {
    name: "claude",
    async runPreparedBatch(batch) {
      const dir = await mkdtemp(join(tmpdir(), "ff-claude-"));
      try {
        const parsed = await runClaude(claudePath, batch.prompt, dir);
        return parseClaudeOutput(parsed);
      } catch (error) {
        parseAgentError(error);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
  return createBatchedAgentRunner(adapter, promptTemplate, "Return only the final JSON object in your result text.");
}

export async function createConfiguredRunner(agent: AgentName, paths: { codexPath: string; claudePath: string }): Promise<AgentRunner> {
  return agent === "claude" ? createClaudeRunner(paths.claudePath) : createCodexRunner(paths.codexPath);
}
