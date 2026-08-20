import type { HostResponse } from "@fluent-frame/shared";
import { createPopupQueue } from "./popupQueue.js";
import { createPopupTabs } from "./popupTabs.js";
import { extractYoutubeVideoIdFromUrl } from "./youtubeUrl.js";

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

function setStatus(message: string): void {
  const status = document.getElementById("status");
  if (status) {
    status.textContent = message;
  }
}

const queue = createPopupQueue({
  doc: document,
  runtime: chrome.runtime,
  openTab: async (url) => {
    await chrome.tabs.create({ url });
  },
  setStatus,
});

const tabs = createPopupTabs({
  tabs: chrome.tabs,
  setStatus,
});

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
  await tabs.generate();
});

document.getElementById("toggle-page-pane")?.addEventListener("click", async () => {
  await tabs.togglePane();
});

document.getElementById("reset-page-pane")?.addEventListener("click", async () => {
  await tabs.resetPane();
});

document.getElementById("enqueue-current")?.addEventListener("click", async () => {
  await tabs.enqueueCurrent((input) => queue.sendAction({ type: "enqueueVideo", ...input }));
});

document.getElementById("enqueue-url-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("enqueue-url");
  const value = input instanceof HTMLInputElement ? input.value : "";
  const videoId = extractYoutubeVideoIdFromUrl(value);
  if (!videoId) {
    setStatus("Paste a valid YouTube video URL.");
    return;
  }
  void queue.sendAction({ type: "enqueueVideo", videoId, url: value });
  if (input instanceof HTMLInputElement) {
    input.value = "";
  }
});

document.getElementById("refresh-health")?.addEventListener("click", () => {
  void refreshHealth();
});

void refreshHealth();
void queue.refresh();
window.setInterval(() => {
  void queue.refresh();
}, QUEUE_REFRESH_INTERVAL_MS);
