import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = fileURLToPath(new URL("../../", import.meta.url));
export async function withLocalCli(fn) {
  const directory = await mkdtemp(join(tmpdir(), "ff-local-cli-"));
  const home = join(directory, "home");
  const bin = join(directory, "bin");
  const trace = join(directory, "calls.jsonl");
  await mkdir(home); await mkdir(bin);
  const stub = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.FF_CLI_CALLS, JSON.stringify({ tool, args, cwd: process.cwd(),
  agent: process.env.FF_AGENT, extensionId: process.env.FF_EXTENSION_ID,
  codexPath: process.env.FF_CODEX_PATH, claudePath: process.env.FF_CLAUDE_PATH,
}) + "\\n");
if (process.env.FF_CLI_FAIL === tool + ":" + args.join(" ")) {
  console.error("fixture command failed"); process.exitCode = 7;
}
`;
  for (const tool of ["pnpm", "git", "open", "codex", "claude", "yt-dlp"]) {
    await writeFile(join(bin, tool), stub, { mode: 0o755 });
  }
  const configPath = join(home, ".fluent-frame/config.json");
  const cli = {
    home, bin, configPath,
    async config(value) { await mkdir(dirname(configPath), { recursive: true }); await writeFile(configPath, typeof value === "string" ? value : JSON.stringify(value)); },
    async calls() { try { return (await readFile(trace, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { if (error.code === "ENOENT") return []; throw error; } },
    run(script, args = [], options = {}) {
      return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, [join(scriptsDir, script), ...args], {
          env: { ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
            HOME: home, PATH: bin + delimiter + dirname(process.execPath),
            FF_CLI_CALLS: trace, FF_CLI_FAIL: options.fail ?? "",
            FF_CODEX_PATH: join(bin, "codex"), FF_CLAUDE_PATH: join(bin, "claude"), FF_YTDLP_PATH: join(bin, "yt-dlp"),
          }, stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "", stderr = "", nextAnswer = 0;
        const answers = options.answers ?? [];
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Local CLI fixture timed out")); }, 10_000);
        child.stdin.on("error", () => {});
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
          const answer = answers[nextAnswer];
          if (answer && stdout.includes(answer.prompt)) { nextAnswer++; child.stdin.write(answer.value + "\n"); }
        });
        child.stderr.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", (error) => { clearTimeout(timer); reject(error); });
        child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
      });
    },
  };
  try { await fn(cli); } finally { await rm(directory, { recursive: true, force: true }); }
}
