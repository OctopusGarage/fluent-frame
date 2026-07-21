import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-logger-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createLogger", () => {
  it("writes structured JSON lines", async () => {
    const logFile = join(dir, "logs", "native-host.log");
    const logger = createLogger(logFile, { now: () => "2026-07-21T00:00:00.000Z" });

    await logger.log({
      level: "info",
      component: "queue",
      event: "job.enqueued",
      message: "Queued",
      requestId: "queue1",
      jobId: "dQw4w9WgXcQ:en:test",
      videoId: "dQw4w9WgXcQ",
      details: { status: "queued" },
    });

    const [line] = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(JSON.parse(line ?? "{}")).toEqual({
      timestamp: "2026-07-21T00:00:00.000Z",
      level: "info",
      component: "queue",
      event: "job.enqueued",
      message: "Queued",
      requestId: "queue1",
      jobId: "dQw4w9WgXcQ:en:test",
      videoId: "dQw4w9WgXcQ",
      details: { status: "queued" },
    });
  });

  it("rotates the current log when it grows too large", async () => {
    const logFile = join(dir, "logs", "native-host.log");
    await mkdir(join(logFile, ".."), { recursive: true });
    await writeFile(logFile, "x".repeat(64), "utf8");
    const logger = createLogger(logFile, { maxBytes: 10, now: () => "2026-07-21T00:00:00.000Z" });

    await logger.log({
      level: "info",
      component: "hostRouter",
      event: "request.started",
      message: "Handling request",
    });

    await expect(readFile(`${logFile}.1`, "utf8")).resolves.toBe("x".repeat(64));
    expect(await readFile(logFile, "utf8")).toContain('"event":"request.started"');
  });
});
