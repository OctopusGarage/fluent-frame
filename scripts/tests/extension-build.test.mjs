import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("extension content script is bundled without shared chunk imports", () => {
  execFileSync("pnpm", ["--filter", "@fluent-frame/extension", "build"], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    stdio: "pipe",
  });

  const contentScript = readFileSync(resolve(import.meta.dirname, "..", "..", "apps/extension/dist/content.js"), "utf8");

  assert.doesNotMatch(contentScript, /^\s*import\b/m);
  assert.doesNotMatch(contentScript, /from\s+["']\.\/assets\//);
});
