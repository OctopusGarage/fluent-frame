import { extractYoutubeVideoIdFromUrl } from "./video.js";

export type PopupTabsDeps = {
  tabs: typeof chrome.tabs;
  setStatus(message: string): void;
};

export function parseYoutubeVideoIdFromUrl(value: string): string | undefined {
  return extractYoutubeVideoIdFromUrl(value);
}

export function createPopupTabs(deps: PopupTabsDeps) {
  async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await deps.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function sendActiveTabMessage(message: unknown, successMessage: string): Promise<void> {
    try {
      const tab = await activeTab();
      if (!tab?.id) {
        deps.setStatus("No active tab.");
        return;
      }
      await deps.tabs.sendMessage(tab.id, message);
      deps.setStatus(successMessage);
    } catch {
      deps.setStatus("Could not reach the YouTube page.");
    }
  }

  return {
    generate() {
      return sendActiveTabMessage({ type: "popupGenerate" }, "Request sent to YouTube page.");
    },
    togglePane() {
      return sendActiveTabMessage({ type: "popupTogglePanel" }, "Page pane toggled.");
    },
    resetPane() {
      return sendActiveTabMessage({ type: "popupResetUi" }, "Page pane layout reset.");
    },
    async enqueueCurrent(
      enqueue: (input: { videoId: string; url: string; title?: string }) => Promise<void>,
    ): Promise<void> {
      try {
        const tab = await activeTab();
        const tabUrl = tab?.url;
        const videoId = tabUrl ? parseYoutubeVideoIdFromUrl(tabUrl) : undefined;
        if (!videoId || !tabUrl) {
          deps.setStatus("Open a YouTube video first.");
          return;
        }
        await enqueue({
          videoId,
          url: tabUrl,
          ...(tab.title ? { title: tab.title } : {}),
        });
      } catch {
        deps.setStatus("Could not add current video to queue.");
      }
    },
  };
}
