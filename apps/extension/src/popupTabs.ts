import { extractYoutubeVideoIdFromUrl } from "./youtubeUrl.js";

export type PopupTabsDeps = {
  tabs: typeof chrome.tabs;
  setStatus(message: string): void;
};

function tabMessageErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(message)
    ? "Refresh the YouTube tab, then try again."
    : "Could not reach the YouTube page.";
}

export function createPopupTabs(deps: PopupTabsDeps) {
  async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await deps.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function sendActiveTabMessage(message: unknown, pendingMessage: string, successMessage: string): Promise<void> {
    try {
      const tab = await activeTab();
      if (!tab?.id) {
        deps.setStatus("No active tab.");
        return;
      }
      deps.setStatus(pendingMessage);
      await deps.tabs.sendMessage(tab.id, message);
      deps.setStatus(successMessage);
    } catch (error) {
      deps.setStatus(tabMessageErrorMessage(error));
    }
  }

  return {
    generate() {
      return sendActiveTabMessage(
        { type: "popupGenerate" },
        "Starting generation on this YouTube tab...",
        "Generation started on the YouTube page.",
      );
    },
    togglePane() {
      return sendActiveTabMessage({ type: "popupTogglePanel" }, "Toggling page pane...", "Page pane toggled.");
    },
    resetPane() {
      return sendActiveTabMessage({ type: "popupResetUi" }, "Resetting page pane...", "Page pane layout reset.");
    },
    async enqueueCurrent(
      enqueue: (input: { videoId: string; url: string; title?: string }) => Promise<void>,
    ): Promise<void> {
      try {
        const tab = await activeTab();
        const tabUrl = tab?.url;
        const videoId = extractYoutubeVideoIdFromUrl(tabUrl);
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
