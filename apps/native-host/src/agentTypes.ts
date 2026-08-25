import type { AgentOutput } from "@fluent-frame/shared";

export type { AgentOutput };

export type AgentBatchProgress = {
  output: AgentOutput;
  completedBatches: number;
  totalBatches: number;
};

export type AgentRunnerOptions = {
  onBatch?: (progress: AgentBatchProgress) => Promise<void> | void;
  resumeFrom?: AgentBatchProgress;
};

export type AgentRunner = (captionText: string, options?: AgentRunnerOptions) => Promise<AgentOutput>;
