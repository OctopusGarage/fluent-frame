import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCodex } from "../src/localAgentProcess.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

let dir = "";

async function writeExecutable(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-local-agent-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("runCodex", () => {
  it("times out after 300 seconds", async () => {
    vi.useFakeTimers();
    const codexPath = await writeExecutable(
      "slow-codex.mjs",
      `#!/usr/bin/env node
setInterval(() => {}, 1000);
`,
    );
    const outputPath = join(dir, "output.json");
    let rejection: unknown;

    const runPromise = runCodex(codexPath, "captions", dir, outputPath);
    runPromise.catch((error: unknown) => {
      rejection = error;
    });

    await vi.advanceTimersByTimeAsync(299_999);
    expect(rejection).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(runPromise).rejects.toThrow("Codex timed out after 300 seconds");
  });
});

// Keep the crash reproduction outside Vitest so an unhandled Socket error is
// reported as a failed assertion, rather than terminating the test worker.
it.each(["runCodex", "runClaude"])("%s catches early exit with a large prompt and reaches finally", async (adapter) => {
  const executable = await writeExecutable("early-exit", "#!/bin/sh\nexit 1\n");
  const moduleUrl = new URL("../src/localAgentProcess.ts", import.meta.url).href;
  const result = childProcess.spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { ${adapter} as run } from ${JSON.stringify(moduleUrl)};
    try {
      await run(${JSON.stringify(executable)}, "x".repeat(1048576), ${JSON.stringify(dir)}, "unused.json");
      process.exitCode = 2;
    } catch (error) {
      console.log(error.message);
    } finally {
      console.log("finally reached");
    }
  `], { encoding: "utf8", timeout: 5000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).not.toContain("Unhandled");
  expect(result.stdout).toContain(`${adapter === "runCodex" ? "codex" : "claude"} exited with 1`);
  expect(result.stdout).toContain("finally reached");
});

describe("agent process event ordering", () => {
  function start() {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
    vi.mocked(childProcess.spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof childProcess.spawn>);
    const promise = runCodex("synthetic-agent", "captions", dir, join(dir, "output.json"));
    return { child, promise };
  }

  it("rejects a zero exit after failed prompt delivery instead of accepting stale output", async () => {
    const { child, promise } = start();
    const error = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const rejected = expect(promise).rejects.toBe(error);
    child.stdin.emit("error", error);
    child.emit("close", 0);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(() => child.stdin.emit("error", error)).not.toThrow();
  });

  it("waits for child close and preserves its stderr diagnostic after a write failure", async () => {
    const { child, promise } = start();
    const onFinally = vi.fn();
    const completed = promise.finally(onFinally);
    const rejected = expect(completed).rejects.toThrow("authentication required");
    child.stdin.emit("error", new Error("write EPIPE"));
    await Promise.resolve();
    expect(onFinally).not.toHaveBeenCalled();
    child.stderr.emit("data", "authentication required\n");
    child.emit("close", 1);
    await rejected;
    expect(onFinally).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the timeout active after a write failure and consumes late errors and close", async () => {
    const { child, promise } = start();
    const rejected = expect(promise).rejects.toThrow("Codex timed out after 300 seconds");
    child.stdin.emit("error", new Error("write EPIPE"));
    await vi.advanceTimersByTimeAsync(300_000);
    await rejected;
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(() => child.stdin.emit("error", new Error("late write EPIPE"))).not.toThrow();
    child.emit("close", 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves missing executable diagnostics and consumes subsequent stdin errors", async () => {
    const { child, promise } = start();
    const rejected = expect(promise).rejects.toThrow("Codex CLI not found at synthetic-agent");
    child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    expect(() => child.stdin.emit("error", new Error("write EPIPE"))).not.toThrow();
    child.emit("close", -2);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves successful delivery and consumes errors after settlement", async () => {
    const { child, promise } = start();
    child.emit("close", 0);
    await expect(promise).resolves.toBeUndefined();
    expect(() => child.stdin.emit("error", new Error("late write EPIPE"))).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
