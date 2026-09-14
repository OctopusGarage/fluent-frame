import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../local-common.mjs";

async function withDirectory(fn) {
  const directory = await mkdtemp(join(tmpdir(), "ff-script-run-"));
  try {
    await fn(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("run preserves literal arguments and child environment while writing in the requested directory", async () => {
  await withDirectory(async (directory) => {
    const filename = "result with spaces; $FF_RUN_TEST_VALUE.json";
    const previousValue = process.env.FF_RUN_TEST_VALUE;
    const output = await run(process.execPath, ["--input-type=module", "-e", `
      import { writeFile } from "node:fs/promises";
      process.stdout.write("starting\\n");
      await writeFile(process.argv[1], JSON.stringify({
        value: process.env.FF_RUN_TEST_VALUE,
        inheritedPath: process.env.PATH,
      }));
      process.stdout.write("saved\\n");
    `, filename], {
      cwd: directory,
      env: { FF_RUN_TEST_VALUE: "child-only" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    assert.equal(output, "starting\nsaved\n");
    assert.deepEqual(JSON.parse(await readFile(join(directory, filename), "utf8")), {
      value: "child-only",
      inheritedPath: process.env.PATH,
    });
    assert.equal(process.env.FF_RUN_TEST_VALUE, previousValue);
  });
});

test("run rejects a failed command with diagnostics before the caller's next filesystem step", async () => {
  await withDirectory(async (directory) => {
    const nextStep = join(directory, "next-step");
    const args = ["-e", "process.exitCode = 7"];

    await assert.rejects(async () => {
      await run(process.execPath, args, { cwd: directory, stdio: "ignore" });
      await writeFile(nextStep, "must not run");
    }, { message: `${process.execPath} ${args.join(" ")} exited with 7` });
    await assert.rejects(readFile(nextStep), { code: "ENOENT" });
  });
});

test("run rejects a missing executable with the original spawn error", async () => {
  await withDirectory(async (directory) => {
    const missingCommand = join(directory, "missing-command");

    await assert.rejects(run(missingCommand, [], { cwd: directory, stdio: "ignore" }), {
      code: "ENOENT",
      path: missingCommand,
    });
  });
});

test("run waits for filesystem work even when stdout is ignored", async () => {
  await withDirectory(async (directory) => {
    const output = await run(process.execPath, ["--input-type=module", "-e", `
      import { writeFile } from "node:fs/promises";
      await writeFile("completed", "saved");
      process.stdout.write("not captured");
    `], { cwd: directory, stdio: "ignore" });

    assert.equal(output, "");
    assert.equal(await readFile(join(directory, "completed"), "utf8"), "saved");
  });
});
