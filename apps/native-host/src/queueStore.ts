import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { parseQueueState, WORKFLOW_VERSION, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { writeJsonFileAtomically } from "./jsonFile.js";

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
  touchRunning(jobId: string): Promise<QueueJob | undefined>;
  markProgress(jobId: string, progress: { completedBatches: number; totalBatches: number }): Promise<QueueJob | undefined>;
  markDone(jobId: string): Promise<QueueJob>;
  markFailed(jobId: string, error: string): Promise<QueueJob>;
  recoverStaleRunningJobs(): Promise<void>;
};

type QueueStoreOptions = {
  now?: () => string;
  staleRunningMs?: number;
};

const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 2 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobId(videoId: string, captionLanguage: string): string {
  return `${videoId}:${captionLanguage}:${WORKFLOW_VERSION}`;
}

function emptyQueue(): QueueState {
  return { paused: false, jobs: [] };
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

function runningJobId(jobs: QueueJob[]): string | undefined {
  return jobs.find((job) => job.status === "running")?.id;
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

function withRunningJobId(jobs: QueueJob[]): QueueState {
  const running = runningJobId(jobs);
  return { paused: false, ...(running ? { runningJobId: running } : {}), jobs };
}

function queuedWithoutRunState(job: QueueJob, updatedAt: string): QueueJob {
  const {
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    completedBatches: _completedBatches,
    totalBatches: _totalBatches,
    error: _error,
    ...rest
  } = job;
  return { ...rest, status: "queued", updatedAt };
}

function doneWithoutError(job: QueueJob, updatedAt: string): QueueJob {
  const { error: _error, ...rest } = job;
  return { ...rest, status: "done", updatedAt, finishedAt: updatedAt };
}

function normalizeState(value: unknown): QueueState {
  return withRunningJobId(parseQueueState(value, "Invalid queue file").jobs);
}

export function createQueueStore(queueFile: string, options: QueueStoreOptions = {}): QueueStore {
  const now = options.now ?? (() => new Date().toISOString());
  const staleRunningMs = options.staleRunningMs ?? 2 * 60 * 1000;
  const lockFile = `${queueFile}.lock`;

  async function withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(queueFile), { recursive: true });
    while (true) {
      try {
        const lock = await open(lockFile, "wx");
        try {
          return await operation();
        } finally {
          await lock.close();
          await unlink(lockFile).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const ageMs = await stat(lockFile).then((file) => Date.now() - file.mtimeMs).catch(() => 0);
        if (ageMs >= STALE_LOCK_MS) {
          await unlink(lockFile).catch(() => {});
        } else {
          await wait(LOCK_RETRY_MS);
        }
      }
    }
  }

  async function readState(): Promise<QueueState> {
    try {
      return normalizeState(JSON.parse(await readFile(queueFile, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyQueue();
      }
      await mkdir(dirname(queueFile), { recursive: true });
      try {
        await rename(queueFile, `${queueFile}.corrupt`);
      } catch {
        // If another request already moved it, a fresh queue is still the right recovery.
      }
      return emptyQueue();
    }
  }

  async function writeState(state: QueueState): Promise<QueueState> {
    const normalized = withRunningJobId(state.jobs);
    await writeJsonFileAtomically(queueFile, normalized);
    return normalized;
  }

  async function updateJob(jobIdToUpdate: string, update: (job: QueueJob) => QueueJob): Promise<QueueJob> {
    return withLock(async () => {
      const state = await readState();
      const job = state.jobs.find((candidate) => candidate.id === jobIdToUpdate);
      if (!job) {
        throw new Error("Queue job not found");
      }
      const nextJob = update(job);
      await writeState({ paused: false, jobs: state.jobs.map((candidate) => candidate.id === jobIdToUpdate ? nextJob : candidate) });
      return nextJob;
    });
  }

  return {
    async enqueue(input) {
      return withLock(async () => {
        const state = await readState();
        const id = jobId(input.videoId, input.captionLanguage);
        const existing = state.jobs.find((job) => job.id === id);
        if (existing) {
          const timestamp = now();
          const enriched = mergeQueueMetadata(existing, input, timestamp);
          if (enriched !== existing) {
            await writeState({ paused: false, jobs: state.jobs.map((job) => job.id === id ? enriched : job) });
          }
          return { job: enriched, message: messageForStatus(enriched.status) };
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
        await writeState({ paused: false, jobs: [...state.jobs, nextJob] });
        return { job: nextJob, message: input.cacheReady ? "Already ready" : "Queued" };
      });
    },
    getQueue: readState,
    async remove(jobIdToRemove) {
      return withLock(async () => {
        const state = await readState();
        return writeState({ paused: false, jobs: state.jobs.filter((job) => job.id !== jobIdToRemove) });
      });
    },
    async retry(jobIdToRetry) {
      const job = await updateJob(jobIdToRetry, (current) => queuedWithoutRunState(current, now()));
      return { job, message: "Queued" };
    },
    async claimNext() {
      return withLock(async () => {
        const state = await readState();
        if (state.jobs.some((job) => job.status === "running")) {
          return undefined;
        }
        const nextJob = state.jobs.find((job) => job.status === "queued");
        if (!nextJob) {
          return undefined;
        }
        const timestamp = now();
        const runningJob: QueueJob = {
          ...nextJob,
          status: "running",
          startedAt: timestamp,
          updatedAt: timestamp,
          completedBatches: 0,
          totalBatches: nextJob.totalBatches ?? 0,
        };
        await writeState({ paused: false, jobs: state.jobs.map((job) => job.id === runningJob.id ? runningJob : job) });
        return runningJob;
      });
    },
    async touchRunning(jobIdToTouch) {
      return withLock(async () => {
        const state = await readState();
        const job = state.jobs.find((candidate) => candidate.id === jobIdToTouch);
        if (!job || job.status !== "running") {
          return undefined;
        }
        const touchedJob: QueueJob = { ...job, updatedAt: now() };
        await writeState({ paused: false, jobs: state.jobs.map((candidate) => candidate.id === jobIdToTouch ? touchedJob : candidate) });
        return touchedJob;
      });
    },
    async markProgress(jobIdToMark, progress) {
      return withLock(async () => {
        const state = await readState();
        const job = state.jobs.find((candidate) => candidate.id === jobIdToMark);
        if (!job || job.status !== "running") {
          return undefined;
        }
        const timestamp = now();
        const progressedJob: QueueJob = {
          ...job,
          updatedAt: timestamp,
          completedBatches: progress.completedBatches,
          totalBatches: progress.totalBatches,
        };
        await writeState({ paused: false, jobs: state.jobs.map((candidate) => candidate.id === jobIdToMark ? progressedJob : candidate) });
        return progressedJob;
      });
    },
    markDone(jobIdToMark) {
      return updateJob(jobIdToMark, (job) => {
        const timestamp = now();
        return doneWithoutError(job, timestamp);
      });
    },
    markFailed(jobIdToMark, error) {
      return updateJob(jobIdToMark, (job) => {
        const timestamp = now();
        return { ...job, status: "failed", updatedAt: timestamp, finishedAt: timestamp, error };
      });
    },
    async recoverStaleRunningJobs() {
      await withLock(async () => {
        const state = await readState();
        const timestamp = now();
        await writeState({
          paused: false,
          jobs: state.jobs.map((job) => job.status === "running"
            && Date.parse(timestamp) - Date.parse(job.updatedAt) >= staleRunningMs
            ? queuedWithoutRunState(job, timestamp)
            : job),
        });
      });
    },
  };
}
