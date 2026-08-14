import { assertAgentOutput, parseSrt, type PhraseExplanation, type RawSubtitleCue, type SubtitleCue } from "@fluent-frame/shared";
import type { AgentOutput, AgentRunner, AgentRunnerOptions } from "./agentTypes.js";
import type { LocalAgentAdapter } from "./localAgentAdapter.js";

const MAX_CUES_PER_AGENT_BATCH = 20;

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

export function prepareCaptionBatches(captionText: string): string[] {
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

export function mergeAgentOutputs(outputs: AgentOutput[]): AgentOutput {
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

export function createBatchedAgentRunner(adapter: LocalAgentAdapter, promptTemplate: string, instruction = ""): AgentRunner {
  return async (captionText: string, options?: AgentRunnerOptions) => {
    return runAgentOverCaptionBatches(captionText, async (preparedCaptionText) => {
      return adapter.runPreparedBatch({
        prompt: buildPrompt(promptTemplate, preparedCaptionText, instruction),
        workingDirectoryPrefix: `ff-${adapter.name}-`,
      });
    }, options);
  };
}
