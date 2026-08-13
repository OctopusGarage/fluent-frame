import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

test("local Chrome install docs avoid machine-specific checkout paths", () => {
  const guide = readFileSync(resolve(repoRoot, "docs/local-chrome-install.md"), "utf8");

  assert.doesNotMatch(guide, /(?:^|\s)(?:\/Users\/[^\s`]+|~\/programming\/[^\s`]+)/);
  assert.match(guide, /apps\/extension\/dist/);
});

test("architecture docs keep local install command ownership aligned with README", () => {
  const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
  const architecture = readFileSync(resolve(repoRoot, "docs/architecture.md"), "utf8");

  assert.match(readme, /pnpm local:install/);
  assert.match(architecture, /pnpm local:install/);
  assert.match(architecture, /pnpm setup.*alias|alias.*pnpm setup/s);
});
