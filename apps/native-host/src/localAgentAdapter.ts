import type { AgentName } from "@fluent-frame/shared";
import type { AgentOutput } from "./agentTypes.js";

export type PreparedAgentBatch = {
  prompt: string;
  workingDirectoryPrefix: string;
};

export type LocalAgentAdapter = {
  name: AgentName;
  runPreparedBatch(batch: PreparedAgentBatch): Promise<AgentOutput>;
};
