import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withLocalCli } from "./helpers/local-cli.mjs";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const commands = (calls) => calls.filter((call) => call.tool !== "open").map((call) => [call.tool, ...call.args]);

test("local update preserves command order and saved native-host configuration", async () => {
  await withLocalCli(async (cli) => {
    await cli.config({ agent: "claude", claudePath: join(cli.bin, "claude") });
    const result = await cli.run("update-local.mjs");
    assert.equal(result.code, 0, result.stderr);
    const calls = await cli.calls();
    assert.deepEqual(commands(calls), [["git", "pull", "--ff-only"], ["pnpm", "install", "--frozen-lockfile"],
      ["pnpm", "build"], ["pnpm", "--filter", "@fluent-frame/native-host", "install:native-host"], ["pnpm", "run", "doctor"]]);
    assert.equal(calls.find((call) => call.args.includes("install:native-host")).agent, "claude");
    assert.match(result.stdout, /click Reload on FluentFrame/);
  });
});

test("local update honors local-only flags and aborts before registration after build failure", async () => {
  await withLocalCli(async (cli) => {
    const result = await cli.run("update-local.mjs", ["--no-pull", "--no-frozen-lockfile"], { fail: "pnpm:build" });
    assert.equal(result.code, 1);
    assert.deepEqual(commands(await cli.calls()), [["pnpm", "install"], ["pnpm", "build"]]);
    assert.match(result.stderr, /exited with 7/);
  });
});

test("local update help has no subprocess side effects", async () => {
  await withLocalCli(async (cli) => {
    const result = await cli.run("update-local.mjs", ["--help"]);
    assert.equal(result.code, 0); assert.match(result.stdout, /--no-frozen-lockfile/);
    assert.deepEqual(await cli.calls(), []);
  });
});

test("Chrome linking validates input before invoking registration and passes a trimmed ID", async () => {
  await withLocalCli(async (cli) => {
    const invalid = await cli.run("link-chrome.mjs", ["invalid"]);
    assert.equal(invalid.code, 1); assert.deepEqual(await cli.calls(), []);
    await cli.config({ agent: "claude" });
    const valid = await cli.run("link-chrome.mjs", [` ${extensionId} `]);
    assert.equal(valid.code, 0, valid.stderr);
    assert.deepEqual((await cli.calls()).map(({ agent, extensionId: id }) => ({ agent, id })), [{ agent: "claude", id: extensionId }]);
  });
});

test("uninstall removes registration and wrapper while preserving user data and is repeatable", async () => {
  await withLocalCli(async (cli) => {
    const manifest = join(cli.home, "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json");
    const wrapper = join(cli.home, ".fluent-frame/bin/native-host");
    const notes = join(cli.home, ".fluent-frame/notes.json");
    for (const file of [manifest, wrapper, notes]) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, "preserved"); }
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await cli.run("uninstall-local.mjs")).code, 0);
    await assert.rejects(readFile(manifest), { code: "ENOENT" }); await assert.rejects(readFile(wrapper), { code: "ENOENT" });
    assert.equal(await readFile(notes, "utf8"), "preserved"); assert.deepEqual(await cli.calls(), []);
  });
});

test("interactive setup persists the selected agent and links the supplied extension", async () => {
  await withLocalCli(async (cli) => {
    const result = await cli.run("setup-local.mjs", [], { answers: [
      { prompt: "Choose local agent", value: "claude" }, { prompt: "Paste the Chrome extension ID", value: extensionId },
    ] });
    assert.equal(result.code, 0, result.stderr);
    const config = JSON.parse(await readFile(cli.configPath, "utf8"));
    assert.deepEqual(config, { agent: "claude", ytDlpPath: join(cli.bin, "yt-dlp"), codexPath: join(cli.bin, "codex"), claudePath: join(cli.bin, "claude") });
    const installs = (await cli.calls()).filter((call) => call.args.includes("install:native-host"));
    assert.equal(installs.length, 2); assert.equal(installs[1].extensionId, extensionId);
    assert(installs.every((call) => call.agent === "claude"));
  });
});

test("setup recovers malformed config, uses its default agent and reports a failed doctor", async () => {
  await withLocalCli(async (cli) => {
    await cli.config("not JSON");
    const result = await cli.run("setup-local.mjs", [], { fail: "pnpm:run doctor", answers: [
      { prompt: "Choose local agent", value: "invalid" }, { prompt: "Paste the Chrome extension ID", value: "" },
    ] });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(cli.configPath, "utf8")).agent, "codex");
    assert.match(result.stdout, /Using codex/); assert.match(result.stdout, /Doctor found remaining setup work/);
    assert.match(result.stdout, /Link later with/);
  });
});

test("local open completes without invoking an agent or package manager", async () => {
  await withLocalCli(async (cli) => {
    const result = await cli.run("open-local.mjs"); assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Load or reload FluentFrame from/);
    assert((await cli.calls()).every((call) => call.tool === "open"));
  });
});
