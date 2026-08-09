import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeNativeMessage, encodeNativeMessage } from "../src/nativeMessaging.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "../..");

describe("native host entrypoint", () => {
  let tempDir: string;

  beforeAll(() => {
    execFileSync("pnpm", ["--filter", "@fluent-frame/shared", "build"], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
    execFileSync("pnpm", ["--filter", "@fluent-frame/native-host", "build"], {
      cwd: workspaceRoot,
      stdio: "pipe",
    });
    tempDir = mkdtempSync(join(tmpdir(), "native host bin "));
  }, 30_000);

  afterAll(() => {
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("responds when launched through a symlinked package bin", async () => {
    const binPath = join(tempDir, "fluent-frame-native-host");
    symlinkSync(join(packageRoot, "dist/index.js"), binPath);

    const response = await runNativeHost(binPath, encodeNativeMessage({ id: "1", type: "getStatus" }));

    expect(response).toMatchObject({
      id: "1",
      ok: true,
      type: "status",
      installed: true,
    });
  });
});

async function runNativeHost(binPath: string, input: Buffer): Promise<unknown> {
  const child = spawn(process.execPath, [binPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  child.stdin.end(input);

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for native host response"));
    }, 2_000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });

  expect(exit).toEqual({ code: 0, signal: null });
  expect(Buffer.concat(stderrChunks).toString("utf8")).toBe("");
  return decodeNativeMessage(Buffer.concat(stdoutChunks));
}
