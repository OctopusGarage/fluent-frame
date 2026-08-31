import { WORKFLOW_VERSION, type QueueJob, type QueueState } from "@fluent-frame/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPopupQueue } from "../src/popupQueue.js";

function job(overrides: Partial<QueueJob>): QueueJob {
  return {
    id: `${overrides.videoId ?? "dQw4w9WgXcQ"}:en:${WORKFLOW_VERSION}`,
    videoId: overrides.videoId ?? "dQw4w9WgXcQ",
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    status: "queued",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function queue(jobs: QueueJob[]): QueueState {
  return { paused: false, jobs };
}

describe("createPopupQueue", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="queue-summary"></div>
      <div id="queue-running"></div>
      <div id="queue-list"></div>
      <div id="subtitle-library-summary"></div>
      <div id="subtitle-library-list"></div>
    `;
    vi.useRealTimers();
  });

  it("renders queue counts, running batch progress, and job actions", async () => {
    vi.setSystemTime(new Date("2026-07-21T00:02:10.000Z"));
    const sendMessage = vi.fn(async () => ({ id: "q1", ok: true, type: "queue", queue: queue([]) }));
    const openTab = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({ doc: document, runtime: { sendMessage }, openTab, setStatus });
    const failed = job({
      id: "failed",
      videoId: "failedVideo",
      status: "failed",
      title: "Broken video",
      error: "Caption download failed",
    });
    const done = job({
      id: "done",
      videoId: "doneVideo",
      status: "done",
      title: "Ready video",
      url: "https://www.youtube.com/watch?v=doneVideo",
    });

    popupQueue.render(queue([
      job({ id: "queued", status: "queued" }),
      job({
        id: "running",
        status: "running",
        title: "Long lesson",
        completedBatches: 2,
        totalBatches: 5,
        updatedAt: "2026-07-21T00:01:00.000Z",
      }),
      done,
      failed,
    ]));

    expect(document.getElementById("queue-summary")?.textContent).toBe(
      "Queued 1 · Running 1 · Ready 1 · Failed 1",
    );
    expect(document.getElementById("queue-running")?.textContent).toBe(
      "Generating: Long lesson - batch 2/5 - 1m ago",
    );
    expect(Array.from(document.querySelectorAll<HTMLElement>(".queue-job")).map((item) => item.dataset.status)).toEqual([
      "queued",
      "running",
      "done",
      "failed",
    ]);

    document.querySelectorAll<HTMLButtonElement>(".queue-job")[2]?.querySelector("button")?.click();
    await Promise.resolve();
    expect(openTab).toHaveBeenCalledWith("https://www.youtube.com/watch?v=doneVideo");

    const failedButtons = Array.from(
      document.querySelectorAll<HTMLElement>(".queue-job")[3]?.querySelectorAll("button") ?? [],
    );
    failedButtons.find((button) => button.textContent === "Retry")?.click();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ type: "retryQueueJob", jobId: "failed" });
  });

  it("surfaces queue action failures without refreshing stale state", async () => {
    const sendMessage = vi.fn(async () => ({ id: "q1", ok: false, type: "error", message: "Queue is unavailable" }));
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });

    await popupQueue.sendAction({ type: "removeQueueJob", jobId: "missing" });

    expect(setStatus).toHaveBeenCalledWith("Queue is unavailable");
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("surfaces rejected queue action messages", async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error("Extension context invalidated");
    });
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });

    await popupQueue.sendAction({ type: "removeQueueJob", jobId: "missing" });

    expect(setStatus).toHaveBeenCalledWith("Extension context invalidated");
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("surfaces queue refresh failures instead of leaving stale queue state silent", async () => {
    const sendMessage = vi.fn(async () => ({ id: "q1", ok: false, type: "error", message: "Native host unavailable" }));
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });

    await popupQueue.refresh();

    expect(setStatus).toHaveBeenCalledWith("Native host unavailable");
  });

  it("keeps a successful queue action visible when the follow-up refresh fails", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        id: "retry-1",
        ok: true,
        type: "queueJob",
        message: "Queued",
        job: job({ id: "failed", status: "queued" }),
      })
      .mockResolvedValueOnce({ id: "q1", ok: false, type: "error", message: "Native host unavailable" });
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });

    await popupQueue.sendAction({ type: "retryQueueJob", jobId: "failed" });

    expect(setStatus).toHaveBeenLastCalledWith("Queued");
  });

  it("binds the pasted URL form to queue enqueue actions", async () => {
    document.body.innerHTML = `
      <form id="enqueue-url-form">
        <input id="enqueue-url" />
      </form>
      <div id="queue-summary"></div>
      <div id="queue-running"></div>
      <div id="queue-list"></div>
    `;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        id: "enqueue-1",
        ok: true,
        type: "queueJob",
        message: "Queued",
        job: job({ id: "queued", status: "queued" }),
      })
      .mockResolvedValueOnce({ id: "q1", ok: true, type: "queue", queue: queue([]) });
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });
    const form = document.getElementById("enqueue-url-form") as HTMLFormElement;
    const input = document.getElementById("enqueue-url") as HTMLInputElement;
    input.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    popupQueue.bindUrlForm();
    form.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: "enqueueVideo",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(input.value).toBe("");
  });

  it("shows validation feedback when the pasted queue URL is invalid", async () => {
    document.body.innerHTML = `
      <form id="enqueue-url-form">
        <input id="enqueue-url" />
      </form>
    `;
    const sendMessage = vi.fn();
    const setStatus = vi.fn();
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage },
      openTab: vi.fn(),
      setStatus,
    });
    const form = document.getElementById("enqueue-url-form") as HTMLFormElement;
    const input = document.getElementById("enqueue-url") as HTMLInputElement;
    input.value = "https://example.com/not-youtube";

    popupQueue.bindUrlForm();
    form.requestSubmit();
    await Promise.resolve();

    expect(setStatus).toHaveBeenCalledWith("Paste a valid YouTube video URL.");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(input.value).toBe("https://example.com/not-youtube");
  });

  it("renders the latest queued videos at the top", () => {
    const popupQueue = createPopupQueue({
      doc: document,
      runtime: { sendMessage: vi.fn() },
      openTab: vi.fn(),
      setStatus: vi.fn(),
    });

    popupQueue.render(queue([
      job({ id: "oldest", videoId: "oldestVideo", title: "Oldest", createdAt: "2026-07-21T00:00:00.000Z" }),
      job({ id: "newest", videoId: "newestVideo", title: "Newest", createdAt: "2026-07-21T00:02:00.000Z" }),
      job({ id: "middle", videoId: "middleVideo", title: "Middle", createdAt: "2026-07-21T00:01:00.000Z" }),
    ]));

    expect(Array.from(document.querySelectorAll<HTMLElement>(".queue-job-title")).map((item) => item.textContent)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });
});
