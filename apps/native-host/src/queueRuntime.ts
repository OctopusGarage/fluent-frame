import type { HostConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createQueuedJobProcessor } from "./queueProcessor.js";
import { createQueueRunner, type QueueRunner } from "./queueRunner.js";
import { createQueueStore, type QueueStore } from "./queueStore.js";
import { startQueue } from "./queueWorkerProcess.js";

const runners = new Map<string, QueueRunner>();

export type QueueRuntime = {
  logger: Logger;
  store: QueueStore;
  runner(): QueueRunner;
  startQueue(): void;
};

function queueRunner(config: HostConfig, logger: Logger, store: QueueStore): QueueRunner {
  const existing = runners.get(config.queueFile);
  if (existing) {
    return existing;
  }
  const runner = createQueueRunner({
    store,
    logger,
    processJob: createQueuedJobProcessor(config, logger, store),
  });
  runners.set(config.queueFile, runner);
  return runner;
}

export function createQueueRuntime(config: HostConfig): QueueRuntime {
  const logger = createLogger(config.logFile);
  const store = createQueueStore(config.queueFile);
  return {
    logger,
    store,
    runner: () => queueRunner(config, logger, store),
    startQueue: () => startQueue(config),
  };
}

export async function runQueueWorker(config: HostConfig): Promise<void> {
  await createQueueRuntime(config).runner().start();
}
