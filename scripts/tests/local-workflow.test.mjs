import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalUpdateSteps, buildNativeHostEnv, getChromeExtensionsOpenCommand } from "../local-workflow.mjs";

test("buildLocalUpdateSteps creates the safe daily update command sequence", () => {
  const steps = buildLocalUpdateSteps({ frozenLockfile: true });

  assert.deepEqual(
    steps.map((step) => [step.label, step.command, step.args]),
    [
      ["Pull latest source", "git", ["pull", "--ff-only"]],
      ["Install dependencies", "pnpm", ["install", "--frozen-lockfile"]],
      ["Build extension and native host", "pnpm", ["build"]],
      ["Refresh native host registration", "pnpm", ["--filter", "@fluent-frame/native-host", "install:native-host"]],
      ["Run setup diagnostics", "pnpm", ["run", "doctor"]],
    ],
  );
});

test("buildLocalUpdateSteps can skip git pull for local-only worktrees", () => {
  const steps = buildLocalUpdateSteps({ pull: false });

  assert.equal(steps.some((step) => step.command === "git"), false);
  assert.deepEqual(steps[0], {
    label: "Install dependencies",
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
  });
});

test("buildLocalUpdateSteps can install without frozen lockfile", () => {
  const steps = buildLocalUpdateSteps({ frozenLockfile: false });

  assert.deepEqual(steps[1], {
    label: "Install dependencies",
    command: "pnpm",
    args: ["install"],
  });
});

test("getChromeExtensionsOpenCommand uses Chrome directly on macOS", () => {
  assert.deepEqual(getChromeExtensionsOpenCommand("darwin"), {
    command: "open",
    args: ["-a", "Google Chrome", "chrome://extensions"],
  });
});

test("getChromeExtensionsOpenCommand returns undefined outside macOS", () => {
  assert.equal(getChromeExtensionsOpenCommand("linux"), undefined);
});

test("buildNativeHostEnv passes saved tool paths to the native-host installer", () => {
  assert.deepEqual(
    buildNativeHostEnv({
      agent: "claude",
      ytDlpPath: "/opt/homebrew/bin/yt-dlp",
      codexPath: "/opt/homebrew/bin/codex",
      claudePath: "/opt/homebrew/bin/claude",
    }),
    {
      FF_AGENT: "claude",
      FF_YTDLP_PATH: "/opt/homebrew/bin/yt-dlp",
      FF_CODEX_PATH: "/opt/homebrew/bin/codex",
      FF_CLAUDE_PATH: "/opt/homebrew/bin/claude",
    },
  );
});
