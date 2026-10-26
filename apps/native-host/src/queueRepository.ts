import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { parseQueueState, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { writeJsonFileAtomically } from "./jsonFile.js";

type QueueChange<T> = { jobs?: QueueJob[]; result: T };

/** File-backed queue adapter. Transitions are synchronous: no slow work under the lock. */
export type QueueRepository = {
  read(): Promise<QueueState>;
  transact<T>(change: (state: QueueState) => QueueChange<T>): Promise<T>;
  updateRunning(
    jobId: string,
    claimId: string,
    update: (job: QueueJob) => QueueJob,
    missing?: "ignore" | "throw",
  ): Promise<QueueJob | undefined>;
};

const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 2 * 60 * 1000;
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyQueue(): QueueState {
  return { paused: false, jobs: [] };
}

function runningJobId(jobs: QueueJob[]): string | undefined {
  return jobs.find((job) => job.status === "running")?.id;
}

function withRunningJobId(jobs: QueueJob[]): QueueState {
  const running = runningJobId(jobs);
  return { paused: false, ...(running ? { runningJobId: running } : {}), jobs };
}

function normalizeState(value: unknown): QueueState {
  return withRunningJobId(parseQueueState(value, "Invalid queue file").jobs);
}

export function createQueueRepository(queueFile: string): QueueRepository {
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
    let content: string;
    try {
      content = await readFile(queueFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyQueue();
      }
      throw error;
    }
    try {
      return normalizeState(JSON.parse(content) as unknown);
    } catch {
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

  async function writeJobs(jobs: QueueJob[]): Promise<QueueState> {
    return writeState({ paused: false, jobs });
  }

  async function transact<T>(change: (state: QueueState) => QueueChange<T>): Promise<T> {
    return withLock(async () => {
      const { jobs, result } = change(await readState());
      if (jobs) await writeJobs(jobs);
      return result;
    });
  }

  return {
    read: readState,
    transact,
    updateRunning(jobId, claimId, update, missing = "ignore") {
      return transact<QueueJob | undefined>((state) => {
        const job = state.jobs.find((candidate) => candidate.id === jobId);
        if (!job && missing === "throw") throw new Error("Queue job not found");
        if (!job || job.status !== "running" || job.claimId !== claimId) {
          return { result: undefined };
        }
        const next = update(job);
        return {
          jobs: state.jobs.map((candidate) => candidate.id === jobId ? next : candidate),
          result: next,
        };
      });
    },
  };
}
