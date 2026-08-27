import { describe, expect, it, vi } from "vitest";
import { createPopupTabs } from "../src/popupTabs.js";

describe("createPopupTabs", () => {
  it("shows immediate feedback when generation is clicked", async () => {
    const setStatus = vi.fn();
    const tabs = {
      query: vi.fn(async () => [{ id: 7, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    } as unknown as typeof chrome.tabs;

    await createPopupTabs({ tabs, setStatus }).generate();

    expect(setStatus).toHaveBeenNthCalledWith(1, "Starting generation on this YouTube tab...");
    expect(setStatus).toHaveBeenLastCalledWith("Generation started on the YouTube page.");
  });

  it("shows a reload hint when the active tab has no current content script", async () => {
    const setStatus = vi.fn();
    const tabs = {
      query: vi.fn(async () => [{ id: 7, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }]),
      sendMessage: vi.fn(async () => {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      }),
    } as unknown as typeof chrome.tabs;

    await createPopupTabs({ tabs, setStatus }).generate();

    expect(setStatus).toHaveBeenLastCalledWith("Refresh the YouTube tab, then try again.");
  });

  it("surfaces content-script command failures instead of reporting success", async () => {
    const setStatus = vi.fn();
    const tabs = {
      query: vi.fn(async () => [{ id: 7, url: "https://www.youtube.com/feed/subscriptions" }]),
      sendMessage: vi.fn(async () => ({ ok: false, message: "Open a YouTube video first." })),
    } as unknown as typeof chrome.tabs;

    await createPopupTabs({ tabs, setStatus }).generate();

    expect(setStatus).toHaveBeenLastCalledWith("Open a YouTube video first.");
  });
});
