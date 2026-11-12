import { randomUUID } from "node:crypto";
import { WORKFLOW_VERSION, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { createQueueRepository } from "./queueRepository.js";

export type QueueStore = {
  enqueue(input: {
    videoId: string;
    captionLanguage: string;
    url?: string;
    title?: string;
    cacheReady?: boolean;
  }): Promise<{ job: QueueJob; message: string }>;
  getQueue(): Promise<QueueState>;
  remove(jobId: string): Promise<QueueState>;
  retry(jobId: string): Promise<{ job: QueueJob; message: string }>;
  claimNext(): Promise<QueueJob | undefined>;
  touchRunning(jobId: string, claimId: string): Promise<QueueJob | undefined>;
  markProgress(jobId: string, progress: { completedBatches: number; totalBatches: number }, claimId: string): Promise<QueueJob | undefined>;
  markDone(jobId: string, claimId: string): Promise<QueueJob | undefined>;
  markFailed(jobId: string, error: string, claimId: string): Promise<QueueJob | undefined>;
  recoverStaleRunningJobs(): Promise<void>;
  staleRecoveryDelayMs(): Promise<number | undefined>;
};

type QueueStoreOptions = {
  now?: () => string;
  staleRunningMs?: number;
};

function jobId(videoId: string, captionLanguage: string): string {
  return `${videoId}:${captionLanguage}:${WORKFLOW_VERSION}`;
}

function messageForStatus(status: QueueJob["status"]): string {
  if (status === "queued") {
    return "Already queued";
  }
  if (status === "running") {
    return "Already generating";
  }
  if (status === "done" || status === "skipped") {
    return "Already ready";
  }
  return "Retry required";
}

function mergeQueueMetadata(job: QueueJob, input: { url?: string; title?: string }, updatedAt: string): QueueJob {
  const title = input.title?.trim();
  const url = input.url?.trim();
  const nextJob = {
    ...job,
    ...(url && job.url !== url ? { url } : {}),
    ...(title && job.title !== title ? { title } : {}),
  };
  return nextJob.url === job.url && nextJob.title === job.title ? job : { ...nextJob, updatedAt };
}

function replaceJob(jobs: QueueJob[], nextJob: QueueJob): QueueJob[] {
  return jobs.map((candidate) => candidate.id === nextJob.id ? nextJob : candidate);
}

function queuedWithoutRunState(job: QueueJob, updatedAt: string): QueueJob {
  const {
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    completedBatches: _completedBatches,
    totalBatches: _totalBatches,
    error: _error,
    claimId: _claimId,
    ...rest
  } = job;
  return { ...rest, status: "queued", updatedAt };
}

function doneWithoutError(job: QueueJob, updatedAt: string): QueueJob {
  const { error: _error, claimId: _claimId, ...rest } = job;
  return { ...rest, status: "done", updatedAt, finishedAt: updatedAt };
}

export function createQueueStore(queueFile: string, options: QueueStoreOptions = {}): QueueStore {
  const now = options.now ?? (() => new Date().toISOString());
  const staleRunningMs = options.staleRunningMs ?? 2 * 60 * 1000;
  const repository = createQueueRepository(queueFile);

  return {
    async enqueue(input) {
      return repository.transact((state) => {
        const id = jobId(input.videoId, input.captionLanguage);
        const existing = state.jobs.find((job) => job.id === id);
        if (existing) {
          const timestamp = now();
          const enriched = mergeQueueMetadata(existing, input, timestamp);
          if (input.cacheReady === true && enriched.status === "failed") {
            const ready = doneWithoutError(enriched, timestamp);
            return { value: { job: ready, message: "Already ready" }, jobs: replaceJob(state.jobs, ready) };
          }
          if (input.cacheReady === false && (enriched.status === "done" || enriched.status === "skipped")) {
            const requeued = queuedWithoutRunState(enriched, timestamp);
            return { value: { job: requeued, message: "Queued" }, jobs: replaceJob(state.jobs, requeued) };
          }
          return {
            value: { job: enriched, message: messageForStatus(enriched.status) },
            ...(enriched !== existing ? { jobs: replaceJob(state.jobs, enriched) } : {}),
          };
        }
        const timestamp = now();
        const nextJob: QueueJob = {
          id,
          videoId: input.videoId,
          ...(input.url ? { url: input.url } : {}),
          ...(input.title ? { title: input.title } : {}),
          captionLanguage: input.captionLanguage,
          workflowVersion: WORKFLOW_VERSION,
          status: input.cacheReady ? "done" : "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(input.cacheReady ? { finishedAt: timestamp } : {}),
        };
        return {
          value: { job: nextJob, message: input.cacheReady ? "Already ready" : "Queued" },
          jobs: [...state.jobs, nextJob],
        };
      });
    },
    getQueue: repository.read,
    async remove(jobIdToRemove) {
      return repository.transact((state) => {
        if (state.jobs.some((job) => job.id === jobIdToRemove && job.status === "running")) {
          throw new Error("Cannot remove a running queue job");
        }
        const jobs = state.jobs.filter((job) => job.id !== jobIdToRemove);
        return { value: { ...state, jobs }, jobs };
      });
    },
    async retry(jobIdToRetry) {
      return repository.transact((state) => {
        const current = state.jobs.find((candidate) => candidate.id === jobIdToRetry);
        if (!current) throw new Error("Queue job not found");
        const job = current.status === "failed" ? queuedWithoutRunState(current, now()) : current;
        return {
          value: { job, message: job.status === "queued" ? "Queued" : messageForStatus(job.status) },
          jobs: replaceJob(state.jobs, job),
        };
      });
    },
    async claimNext() {
      return repository.transact<QueueJob | undefined>((state) => {
        if (state.jobs.some((job) => job.status === "running")) {
          return { value: undefined };
        }
        const nextJob = state.jobs.find((job) => job.status === "queued");
        if (!nextJob) {
          return { value: undefined };
        }
        const timestamp = now();
        const runningJob: QueueJob = {
          ...nextJob,
          status: "running",
          claimId: randomUUID(),
          startedAt: timestamp,
          updatedAt: timestamp,
          completedBatches: 0,
          totalBatches: nextJob.totalBatches ?? 0,
        };
        return { value: runningJob, jobs: replaceJob(state.jobs, runningJob) };
      });
    },
    async touchRunning(jobIdToTouch, claimId) {
      return repository.updateRunning(jobIdToTouch, claimId, "ignore", (job) => ({ ...job, updatedAt: now() }));
    },
    async markProgress(jobIdToMark, progress, claimId) {
      return repository.updateRunning(jobIdToMark, claimId, "ignore", (job) => ({
        ...job,
        updatedAt: now(),
        completedBatches: progress.completedBatches,
        totalBatches: progress.totalBatches,
      }));
    },
    async markDone(jobIdToMark, claimId) {
      return repository.updateRunning(jobIdToMark, claimId, "throw", (job) => doneWithoutError(job, now()));
    },
    async markFailed(jobIdToMark, error, claimId) {
      return repository.updateRunning(jobIdToMark, claimId, "throw", (job) => {
        const timestamp = now();
        const { claimId: _claimId, ...rest } = job;
        return { ...rest, status: "failed", updatedAt: timestamp, finishedAt: timestamp, error };
      });
    },
    async recoverStaleRunningJobs() {
      await repository.transact((state) => {
        const timestamp = now();
        return {
          value: undefined,
          jobs: state.jobs.map((job) => (
            job.status === "running" && Date.parse(timestamp) - Date.parse(job.updatedAt) >= staleRunningMs
              ? queuedWithoutRunState(job, timestamp)
              : job
          )),
        };
      });
    },
    async staleRecoveryDelayMs() {
      const state = await repository.read();
      const running = state.jobs.find((job) => job.status === "running");
      if (!running || !state.jobs.some((job) => job.status === "queued")) {
        return undefined;
      }
      return Math.max(1, staleRunningMs - (Date.parse(now()) - Date.parse(running.updatedAt)));
    },
  };
}
