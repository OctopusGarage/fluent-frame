import type { HostResponse, QueueJob, QueueState } from "@fluent-frame/shared";

export type PopupQueueRuntime = {
  sendMessage(message: unknown): Promise<unknown>;
};

export type PopupQueueDeps = {
  doc: Document;
  runtime: PopupQueueRuntime;
  openTab(url: string): Promise<void>;
  setStatus(message: string): void;
};

function queueCounts(queue: QueueState): { queued: number; running: number; done: number; failed: number } {
  return {
    queued: queue.jobs.filter((job) => job.status === "queued").length,
    running: queue.jobs.filter((job) => job.status === "running").length,
    done: queue.jobs.filter((job) => job.status === "done" || job.status === "skipped").length,
    failed: queue.jobs.filter((job) => job.status === "failed").length,
  };
}

function jobLabel(job: QueueJob): string {
  return job.title || job.videoId;
}

function formatRelativeTime(timestamp: string): string {
  const elapsedMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "just now";
  }
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 5) {
    return "just now";
  }
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  return `${Math.floor(elapsedSeconds / 60)}m ago`;
}

function jobDetail(job: QueueJob): string {
  if (job.status === "failed" && job.error) {
    return job.error;
  }
  if (job.status === "running") {
    const completed = job.completedBatches ?? 0;
    if (job.totalBatches && job.totalBatches > 0) {
      return `Generating batch ${completed}/${job.totalBatches} - updated ${formatRelativeTime(job.updatedAt)}`;
    }
    return `Preparing batches - updated ${formatRelativeTime(job.updatedAt)}`;
  }
  return job.url || `https://www.youtube.com/watch?v=${job.videoId}`;
}

function canOpenJob(job: QueueJob): boolean {
  return job.status === "done" || job.status === "skipped";
}

function runningJobText(job: QueueJob): string {
  const label = jobLabel(job);
  const completed = job.completedBatches ?? 0;
  if (job.totalBatches && job.totalBatches > 0) {
    return `Generating: ${label} - batch ${completed}/${job.totalBatches} - ${formatRelativeTime(job.updatedAt)}`;
  }
  return `Generating: ${label} - preparing batches - ${formatRelativeTime(job.updatedAt)}`;
}

function timestampMs(job: QueueJob): number {
  const createdMs = Date.parse(job.createdAt);
  if (Number.isFinite(createdMs)) {
    return createdMs;
  }
  const updatedMs = Date.parse(job.updatedAt);
  return Number.isFinite(updatedMs) ? updatedMs : 0;
}

function latestJobsFirst(jobs: QueueJob[]): QueueJob[] {
  return [...jobs].sort((left, right) => timestampMs(right) - timestampMs(left));
}

export function createPopupQueue(deps: PopupQueueDeps) {
  async function refresh(): Promise<void> {
    const response = (await deps.runtime.sendMessage({ type: "getQueue" })) as HostResponse;
    if (response?.ok && response.type === "queue") {
      render(response.queue);
    }
  }

  async function sendAction(message: unknown): Promise<void> {
    let response: HostResponse;
    try {
      response = (await deps.runtime.sendMessage(message)) as HostResponse;
    } catch (error) {
      deps.setStatus(error instanceof Error ? error.message : "Queue request failed.");
      return;
    }
    if (!response?.ok) {
      deps.setStatus(response?.message ?? "Queue request failed.");
      return;
    }
    if (response.type === "queueJob") {
      deps.setStatus(response.message);
    }
    await refresh();
  }

  function render(queue: QueueState): void {
    const summary = deps.doc.getElementById("queue-summary");
    const running = deps.doc.getElementById("queue-running");
    const list = deps.doc.getElementById("queue-list");
    if (!summary || !running || !list) {
      return;
    }
    const counts = queueCounts(queue);
    summary.textContent = `Queued ${counts.queued} · Running ${counts.running} · Ready ${counts.done} · Failed ${counts.failed}`;
    const runningJob = queue.jobs.find((job) => job.status === "running");
    running.textContent = runningJob ? runningJobText(runningJob) : "No active generation";
    list.replaceChildren(
      ...latestJobsFirst(queue.jobs).slice(0, 8).map((job) => {
        const item = deps.doc.createElement("article");
        const text = deps.doc.createElement("div");
        const title = deps.doc.createElement("div");
        const detail = deps.doc.createElement("div");
        const actions = deps.doc.createElement("div");
        const remove = deps.doc.createElement("button");
        item.className = "queue-job";
        item.dataset.status = job.status;
        text.className = "queue-job-text";
        title.className = "queue-job-title";
        title.textContent = jobLabel(job);
        detail.className = "queue-job-detail";
        detail.textContent = `${job.status} - ${jobDetail(job)}`;
        text.append(title, detail);
        actions.className = "queue-job-actions";
        if (job.status === "failed") {
          const retry = deps.doc.createElement("button");
          retry.type = "button";
          retry.textContent = "Retry";
          retry.addEventListener("click", () => {
            void sendAction({ type: "retryQueueJob", jobId: job.id });
          });
          actions.append(retry);
        }
        if (canOpenJob(job)) {
          const open = deps.doc.createElement("button");
          open.type = "button";
          open.textContent = "Open";
          open.addEventListener("click", () => {
            void deps.openTab(jobDetail(job));
          });
          actions.append(open);
        }
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          void sendAction({ type: "removeQueueJob", jobId: job.id });
        });
        actions.append(remove);
        item.append(text, actions);
        return item;
      }),
    );
  }

  return {
    refresh,
    sendAction,
    render,
  };
}
