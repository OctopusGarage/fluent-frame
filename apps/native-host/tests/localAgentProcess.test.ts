import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCodex } from "../src/localAgentProcess.js";

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
