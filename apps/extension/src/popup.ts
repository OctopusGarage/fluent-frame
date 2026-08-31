import { createPopupHealth } from "./popupHealth.js";
import { createPopupLibrary } from "./popupLibrary.js";
import { createPopupQueue } from "./popupQueue.js";
import { createPopupTabs } from "./popupTabs.js";
import { extractYoutubeVideoIdFromUrl } from "./youtubeUrl.js";

const QUEUE_REFRESH_INTERVAL_MS = 5_000;

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

const library = createPopupLibrary({
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

const health = createPopupHealth({
  doc: document,
  runtime: chrome.runtime,
  setStatus,
});

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
  void health.refresh();
});

void health.refresh();
void queue.refresh();
void library.refresh();
window.setInterval(() => {
  void queue.refresh();
  void library.refresh({ preserveStatusOnFailure: true });
}, QUEUE_REFRESH_INTERVAL_MS);
