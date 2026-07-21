import type { QueueJob, QueueState } from "@fluent-frame/shared";

export type QueueCoordinatorStore = {
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
  recoverStaleRunningJobs(): Promise<void>;
};

export type QueueCoordinator = {
  enqueueVideo(input: {
    videoId: string;
    captionLanguage: string;
    url?: string;
    title?: string;
  }): Promise<{ job: QueueJob; message: string }>;
  getQueue(): Promise<QueueState>;
  removeJob(jobId: string): Promise<QueueState>;
  retryJob(jobId: string): Promise<{ job: QueueJob; message: string }>;
};

export type QueueCoordinatorDeps = {
  store: QueueCoordinatorStore;
  cacheReady(input: { videoId: string; captionLanguage: string }): Promise<boolean>;
  resolveTitle(videoId: string, title: string | undefined): Promise<string | undefined>;
  startQueue(): void;
  log(event: {
    event: string;
    message: string;
    job?: QueueJob;
    queue?: QueueState;
    jobId?: string;
  }): Promise<void> | void;
};

async function enrichMissingQueueTitles(deps: QueueCoordinatorDeps): Promise<QueueState> {
  let queue = await deps.store.getQueue();
  for (const job of queue.jobs.filter((candidate) => !candidate.title).slice(0, 8)) {
    const title = await deps.resolveTitle(job.videoId, undefined);
    if (title) {
      await deps.store.enqueue({
        videoId: job.videoId,
        captionLanguage: job.captionLanguage,
        ...(job.url ? { url: job.url } : {}),
        title,
      });
    }
  }
  queue = await deps.store.getQueue();
  return queue;
}

export function createQueueCoordinator(deps: QueueCoordinatorDeps): QueueCoordinator {
  return {
    async enqueueVideo(input) {
      const title = await deps.resolveTitle(input.videoId, input.title);
      const { job, message } = await deps.store.enqueue({
        videoId: input.videoId,
        captionLanguage: input.captionLanguage,
        ...(input.url ? { url: input.url } : {}),
        ...(title ? { title } : {}),
        cacheReady: await deps.cacheReady({
          videoId: input.videoId,
          captionLanguage: input.captionLanguage,
        }),
      });
      await deps.log({ event: "job.enqueued", message, job });
      if (job.status === "queued") {
        deps.startQueue();
      }
      return { job, message };
    },
    async getQueue() {
      await deps.store.recoverStaleRunningJobs();
      const queue = await enrichMissingQueueTitles(deps);
      if (!queue.runningJobId && queue.jobs.some((job) => job.status === "queued")) {
        deps.startQueue();
      }
      await deps.log({ event: "queue.read", message: "Read learning subtitle queue", queue });
      return queue;
    },
    async removeJob(jobId) {
      const queue = await deps.store.remove(jobId);
      await deps.log({ event: "job.removed", message: "Removed learning subtitle queue job", queue, jobId });
      return queue;
    },
    async retryJob(jobId) {
      const { job, message } = await deps.store.retry(jobId);
      await deps.log({ event: "job.retry", message, job });
      deps.startQueue();
      return { job, message };
    },
  };
}
