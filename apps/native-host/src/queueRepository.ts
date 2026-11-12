import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { parseQueueState, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { writeJsonFileAtomically } from "./jsonFile.js";

type QueueDecision<T> = { value: T; jobs?: QueueJob[] };

function snapshot(jobs: QueueJob[]): QueueState {
  const runningJobId = jobs.find((job) => job.status === "running")?.id;
  return { paused: false, ...(runningJobId ? { runningJobId } : {}), jobs };
}

const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 2 * 60 * 1000;

/** File-backed queue transactions. Decisions are synchronous: no processing or observers under the lock. */
export function createQueueRepository(queueFile: string) {
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
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
        }
      }
    }
  }

  async function read(): Promise<QueueState> {
    let content: string;
    try {
      content = await readFile(queueFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return snapshot([]);
      }
      throw error;
    }
    try {
      return snapshot(parseQueueState(JSON.parse(content) as unknown, "Invalid queue file").jobs);
    } catch {
      await mkdir(dirname(queueFile), { recursive: true });
      try {
        await rename(queueFile, `${queueFile}.corrupt`);
      } catch {
        // If another request already moved it, a fresh queue is still the right recovery.
      }
      return snapshot([]);
    }
  }

  async function transact<T>(decide: (state: QueueState) => QueueDecision<T>): Promise<T> {
    return withLock(async () => {
      const decision = decide(await read());
      if (decision.jobs !== undefined) {
        await writeJsonFileAtomically(queueFile, snapshot(decision.jobs));
      }
      return decision.value;
    });
  }

  return {
    read,
    transact,
    /** Reread, fence and persist as one transaction; rejected claims never invoke update or write. */
    updateRunning(
      jobId: string,
      claimId: string,
      missing: "ignore" | "throw",
      update: (job: QueueJob) => QueueJob,
    ): Promise<QueueJob | undefined> {
      return transact<QueueJob | undefined>((state) => {
        const job = state.jobs.find((candidate) => candidate.id === jobId);
        if (!job) {
          if (missing === "throw") throw new Error("Queue job not found");
          return { value: undefined };
        }
        if (job.status !== "running" || job.claimId !== claimId) return { value: undefined };
        const nextJob = update(job);
        return { value: nextJob, jobs: state.jobs.map((candidate) => candidate.id === jobId ? nextJob : candidate) };
      });
    },
  };
}
