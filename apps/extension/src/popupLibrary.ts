import type { CachedVideoSummary, HostResponse } from "@fluent-frame/shared";

export type PopupLibraryRuntime = {
  sendMessage(message: unknown): Promise<unknown>;
};

export type PopupLibraryDeps = {
  doc: Document;
  runtime: PopupLibraryRuntime;
  openTab(url: string): Promise<void>;
  setStatus(message: string): void;
};

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
  if (elapsedSeconds < 3600) {
    return `${Math.floor(elapsedSeconds / 60)}m ago`;
  }
  return `${Math.floor(elapsedSeconds / 3600)}h ago`;
}

function videoUrl(video: CachedVideoSummary): string {
  return `https://www.youtube.com/watch?v=${video.videoId}`;
}

function sortAtMs(video: CachedVideoSummary): number {
  const parsed = Date.parse(video.sortAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestVideosFirst(videos: CachedVideoSummary[]): CachedVideoSummary[] {
  return [...videos].sort((left, right) => sortAtMs(right) - sortAtMs(left));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function videoDetail(video: CachedVideoSummary): string {
  const watchedText = video.lastWatchedAt
    ? `watched ${formatRelativeTime(video.lastWatchedAt)}`
    : `generated ${formatRelativeTime(video.generatedAt)}`;
  return `${watchedText} - ${plural(video.subtitleCount, "subtitle")} - ${plural(video.phraseCount, "phrase")}`;
}

function videoTitle(video: CachedVideoSummary): string {
  return video.title?.trim() || video.videoId;
}

export function createPopupLibrary(deps: PopupLibraryDeps) {
  async function refresh(options: { preserveStatusOnFailure?: boolean } = {}): Promise<void> {
    try {
      const response = (await deps.runtime.sendMessage({ type: "listCachedVideos" })) as HostResponse;
      if (response?.ok && response.type === "cachedVideos") {
        render(response.videos);
        return;
      }
      if (!options.preserveStatusOnFailure) {
        deps.setStatus(response && !response.ok ? response.message : "Subtitle library refresh failed.");
      }
    } catch (error) {
      if (!options.preserveStatusOnFailure) {
        deps.setStatus(error instanceof Error ? error.message : "Subtitle library refresh failed.");
      }
    }
  }

  function render(videos: CachedVideoSummary[]): void {
    const summary = deps.doc.getElementById("subtitle-library-summary");
    const list = deps.doc.getElementById("subtitle-library-list");
    if (!summary || !list) {
      return;
    }
    summary.textContent = videos.length === 0
      ? "No subtitle results yet"
      : `${videos.length} ${videos.length === 1 ? "video" : "videos"} with subtitles`;
    list.replaceChildren(
      ...latestVideosFirst(videos).map((video) => {
        const item = deps.doc.createElement("article");
        const text = deps.doc.createElement("div");
        const title = deps.doc.createElement("div");
        const detail = deps.doc.createElement("div");
        const open = deps.doc.createElement("button");
        item.className = "subtitle-library-item";
        text.className = "subtitle-library-text";
        title.className = "subtitle-library-title";
        title.textContent = videoTitle(video);
        detail.className = "subtitle-library-detail";
        detail.textContent = videoDetail(video);
        open.type = "button";
        open.textContent = "Open";
        open.addEventListener("click", () => {
          void deps.openTab(videoUrl(video));
        });
        text.append(title, detail);
        item.append(text, open);
        return item;
      }),
    );
  }

  return {
    refresh,
    render,
  };
}
