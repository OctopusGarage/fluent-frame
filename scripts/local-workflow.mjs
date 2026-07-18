export function buildNativeHostEnv(config = {}) {
  const env = {};
  if (config.agent) {
    env.FF_AGENT = config.agent;
  }
  if (config.ytDlpPath) {
    env.FF_YTDLP_PATH = config.ytDlpPath;
  }
  if (config.codexPath) {
    env.FF_CODEX_PATH = config.codexPath;
  }
  if (config.claudePath) {
    env.FF_CLAUDE_PATH = config.claudePath;
  }
  return env;
}

export function buildLocalUpdateSteps(options = {}) {
  const pull = options.pull !== false;
  const frozenLockfile = options.frozenLockfile !== false;
  const steps = [];

  if (pull) {
    steps.push({
      label: "Pull latest source",
      command: "git",
      args: ["pull", "--ff-only"],
    });
  }

  steps.push(
    {
      label: "Install dependencies",
      command: "pnpm",
      args: frozenLockfile ? ["install", "--frozen-lockfile"] : ["install"],
    },
    {
      label: "Build extension and native host",
      command: "pnpm",
      args: ["build"],
    },
    {
      label: "Refresh native host registration",
      command: "pnpm",
      args: ["--filter", "@fluent-frame/native-host", "install:native-host"],
    },
    {
      label: "Run setup diagnostics",
      command: "pnpm",
      args: ["run", "doctor"],
    },
  );

  return steps;
}

export function getChromeExtensionsOpenCommand(currentPlatform) {
  if (currentPlatform !== "darwin") {
    return undefined;
  }
  return {
    command: "open",
    args: ["-a", "Google Chrome", "chrome://extensions"],
  };
}

export function shouldSkipPull(argv) {
  return argv.includes("--no-pull");
}

export function shouldUseFrozenLockfile(argv) {
  return !argv.includes("--no-frozen-lockfile");
}

export function hasHelpFlag(argv) {
  return argv.includes("--help") || argv.includes("-h");
}
