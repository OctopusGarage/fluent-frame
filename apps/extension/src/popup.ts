import type { HostResponse, QueueJob, QueueState } from "@fluent-frame/shared";

const QUEUE_REFRESH_INTERVAL_MS = 5_000;

type PopupHealthResponse =
  | {
      ok: true;
      type: "health";
      health: {
        agent: "codex" | "claude";
        workflowVersion: string;
        ytDlpPath: string;
        codexPath?: string;
        claudePath?: string;
        checks: {
          ytDlp: boolean;
          codex: boolean;
          claude: boolean;
        };
      };
    }
  | {
      ok: false;
      type: "error";
      code: string;
      message: string;
    };

function parseYoutubeVideoIdFromUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const id = url.searchParams.get("v");
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}

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

async function openJob(job: QueueJob): Promise<void> {
  await chrome.tabs.create({ url: jobDetail(job) });
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

function runningJobText(job: QueueJob): string {
  const label = jobLabel(job);
  const completed = job.completedBatches ?? 0;
  if (job.totalBatches && job.totalBatches > 0) {
    return `Generating: ${label} - batch ${completed}/${job.totalBatches} - ${formatRelativeTime(job.updatedAt)}`;
  }
  return `Generating: ${label} - preparing batches - ${formatRelativeTime(job.updatedAt)}`;
}

function renderQueue(queue: QueueState): void {
  const summary = document.getElementById("queue-summary");
  const running = document.getElementById("queue-running");
  const list = document.getElementById("queue-list");
  if (!summary || !running || !list) {
    return;
  }
  const counts = queueCounts(queue);
  summary.textContent = `Queued ${counts.queued} · Running ${counts.running} · Ready ${counts.done} · Failed ${counts.failed}`;
  const runningJob = queue.jobs.find((job) => job.status === "running");
  running.textContent = runningJob ? runningJobText(runningJob) : "No active generation";
  list.replaceChildren(
    ...queue.jobs.slice(0, 8).map((job) => {
      const item = document.createElement("article");
      const text = document.createElement("div");
      const title = document.createElement("div");
      const detail = document.createElement("div");
      const actions = document.createElement("div");
      const remove = document.createElement("button");
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
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => {
          void sendQueueAction({ type: "retryQueueJob", jobId: job.id });
        });
        actions.append(retry);
      }
      if (canOpenJob(job)) {
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Open";
        open.addEventListener("click", () => {
          void openJob(job);
        });
        actions.append(open);
      }
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        void sendQueueAction({ type: "removeQueueJob", jobId: job.id });
      });
      actions.append(remove);
      item.append(text, actions);
      return item;
    }),
  );
}

async function refreshQueue(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "getQueue" })) as HostResponse;
  if (response?.ok && response.type === "queue") {
    renderQueue(response.queue);
  }
}

async function sendQueueAction(message: unknown): Promise<void> {
  const response = (await chrome.runtime.sendMessage(message)) as HostResponse;
  if (!response?.ok) {
    setStatus(response?.message ?? "Queue request failed.");
    return;
  }
  if (response.type === "queueJob") {
    setStatus(response.message);
  }
  await refreshQueue();
}

function setHealthLine(id: string, label: string, healthy: boolean, detail: string): void {
  const target = document.getElementById(id);
  if (!target) {
    return;
  }
  target.textContent = `${healthy ? "OK" : "Needs setup"} - ${label}${detail ? `: ${detail}` : ""}`;
  target.dataset.state = healthy ? "ok" : "missing";
}

async function refreshHealth(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "healthCheck" })) as PopupHealthResponse;
    if (!response?.ok || response.type !== "health") {
      setHealthLine("native-host", "Native host", false, response?.message ?? "not connected");
      setHealthLine("yt-dlp", "yt-dlp", false, "");
      setHealthLine("agent", "Agent", false, "run pnpm setup");
      setStatus("Run pnpm setup, then pnpm link:chrome <extension-id>.");
      return;
    }

    const health = response.health;
    const agentAvailable = health.agent === "claude" ? health.checks.claude : health.checks.codex;
    setHealthLine("native-host", "Native host", true, health.workflowVersion);
    setHealthLine("yt-dlp", "yt-dlp", health.checks.ytDlp, health.ytDlpPath);
    setHealthLine(
      "agent",
      `${health.agent === "claude" ? "Claude" : "Codex"} agent`,
      agentAvailable,
      health.agent === "claude" ? (health.claudePath ?? "") : (health.codexPath ?? ""),
    );
    setStatus(
      agentAvailable && health.checks.ytDlp ? "FluentFrame is ready." : "Run pnpm run doctor for local setup fixes.",
    );
  } catch {
    setHealthLine("native-host", "Native host", false, "not connected");
    setHealthLine("yt-dlp", "yt-dlp", false, "");
    setHealthLine("agent", "Agent", false, "");
    setStatus("Run pnpm setup, then pnpm link:chrome <extension-id>.");
  }
}

document.getElementById("generate")?.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus("No active tab.");
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "popupGenerate" });
    setStatus("Request sent to YouTube page.");
  } catch {
    setStatus("Could not reach the YouTube page.");
  }
});

document.getElementById("enqueue-current")?.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabUrl = tab?.url;
    const videoId = tabUrl ? parseYoutubeVideoIdFromUrl(tabUrl) : undefined;
    if (!videoId) {
      setStatus("Open a YouTube video first.");
      return;
    }
    await sendQueueAction({ type: "enqueueVideo", videoId, url: tabUrl, title: tab?.title });
  } catch {
    setStatus("Could not add current video to queue.");
  }
});

document.getElementById("enqueue-url-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("enqueue-url");
  const value = input instanceof HTMLInputElement ? input.value : "";
  const videoId = parseYoutubeVideoIdFromUrl(value);
  if (!videoId) {
    setStatus("Paste a valid YouTube video URL.");
    return;
  }
  void sendQueueAction({ type: "enqueueVideo", videoId, url: value });
  if (input instanceof HTMLInputElement) {
    input.value = "";
  }
});

document.getElementById("refresh-health")?.addEventListener("click", () => {
  void refreshHealth();
});

void refreshHealth();
void refreshQueue();
window.setInterval(() => {
  void refreshQueue();
}, QUEUE_REFRESH_INTERVAL_MS);
