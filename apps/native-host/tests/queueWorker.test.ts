import { describe, expect, it, vi } from "vitest";
import type { HostConfig } from "../src/config.js";
import { isQueueReadyOutput, startDetachedQueueWorker } from "../src/queueRequestHandler.js";

function config(): HostConfig {
  return {
    dataDir: "/tmp/fluent-frame",
    agent: "codex",
    cacheDir: "/tmp/fluent-frame/cache",
    notesFile: "/tmp/fluent-frame/notes.json",
    queueFile: "/tmp/fluent-frame/queue/jobs.json",
    logFile: "/tmp/fluent-frame/logs/native-host.log",
    ytDlpPath: "yt-dlp",
    codexPath: "codex",
    claudePath: "claude",
  };
}

describe("queue worker startup", () => {
  it("treats cached, generated, and partial fallback output as queue-ready", () => {
    expect(isQueueReadyOutput("cache")).toBe(true);
    expect(isQueueReadyOutput("generated")).toBe(true);
    expect(isQueueReadyOutput("partialFallback")).toBe(true);
    expect(isQueueReadyOutput("sourceFallback")).toBe(false);
  });

  it("starts queue processing in a detached worker process", async () => {
    const unref = vi.fn();
    const spawnDetached = vi.fn(() => ({ unref }));

    await startDetachedQueueWorker(config(), {
      entrypointPath: "/repo/apps/native-host/dist/index.js",
      spawnDetached,
      env: { PATH: "/usr/bin", FF_QUEUE_WORKER: "old" },
    });

    expect(spawnDetached).toHaveBeenCalledWith(
      process.execPath,
      ["/repo/apps/native-host/dist/index.js"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: expect.objectContaining({
          FF_QUEUE_WORKER: "1",
          FF_QUEUE_FILE: "/tmp/fluent-frame/queue/jobs.json",
          FF_CACHE_DIR: "/tmp/fluent-frame/cache",
        }),
      }),
    );
    expect(unref).toHaveBeenCalledOnce();
  });
});
