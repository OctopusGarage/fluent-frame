import { WORKFLOW_VERSION, type CachedVideoSummary } from "@fluent-frame/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPopupLibrary } from "../src/popupLibrary.js";

function video(overrides: Partial<CachedVideoSummary>): CachedVideoSummary {
  return {
    videoId: overrides.videoId ?? "dQw4w9WgXcQ",
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    generatedAt: "2026-07-21T00:00:00.000Z",
    sortAt: "2026-07-21T00:00:00.000Z",
    subtitleCount: 1,
    phraseCount: 1,
    ...overrides,
  };
}

describe("createPopupLibrary", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="subtitle-library-summary"></div>
      <div id="subtitle-library-list"></div>
    `;
  });

  it("renders cached videos sorted by recent watch time and opens the selected video", async () => {
    vi.setSystemTime(new Date("2026-07-24T00:05:00.000Z"));
    const openTab = vi.fn(async () => undefined);
    const library = createPopupLibrary({
      doc: document,
      runtime: {
        sendMessage: vi.fn(async () => ({
          id: "library1",
          ok: true,
          type: "cachedVideos",
          videos: [
            video({ videoId: "oldvideo123", sortAt: "2026-07-22T00:00:00.000Z" }),
            video({
              videoId: "newvideo123",
              lastWatchedAt: "2026-07-24T00:00:00.000Z",
              sortAt: "2026-07-24T00:00:00.000Z",
              subtitleCount: 3,
              phraseCount: 2,
            }),
          ],
        })),
      },
      openTab,
      setStatus: vi.fn(),
    });

    await library.refresh();

    expect(document.getElementById("subtitle-library-summary")?.textContent).toBe("2 videos with subtitles");
    expect(Array.from(document.querySelectorAll<HTMLElement>(".subtitle-library-title")).map((item) => item.textContent)).toEqual([
      "newvideo123",
      "oldvideo123",
    ]);
    expect(document.querySelector<HTMLElement>(".subtitle-library-detail")?.textContent).toContain("watched 5m ago");
    expect(document.querySelector<HTMLElement>(".subtitle-library-detail")?.textContent).toContain("3 subtitles");
    document.querySelector<HTMLButtonElement>(".subtitle-library-item button")?.click();
    await Promise.resolve();
    expect(openTab).toHaveBeenCalledWith("https://www.youtube.com/watch?v=newvideo123");
  });
});
