import type { PhraseExplanation, SubtitleCue } from "@fluent-frame/shared";

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
