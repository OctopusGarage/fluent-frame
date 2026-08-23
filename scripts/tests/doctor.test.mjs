import test from "node:test";
import assert from "node:assert/strict";

import { evaluateNativeHostRegistration, parseWrapperExec } from "../doctor.mjs";

test("parseWrapperExec extracts the node binary and host target from the wrapper", () => {
  assert.deepEqual(
    parseWrapperExec(`#\\!/bin/sh
export PATH='/usr/local/bin:$PATH'
exec "/usr/local/bin/node" "/Users/example/.fluent-frame/host/native-host/index.js"
`.replace("\\!", "!")),
    {
      nodePath: "/usr/local/bin/node",
      hostPath: "/Users/example/.fluent-frame/host/native-host/index.js",
    },
  );
});

test("evaluateNativeHostRegistration rejects wrappers whose host target is missing", () => {
  const result = evaluateNativeHostRegistration({
    manifest: {
      path: "/Users/example/.fluent-frame/bin/native-host",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    },
    wrapperContent: `#\\!/bin/sh
exec "/usr/local/bin/node" "/deleted/worktree/apps/native-host/dist/index.js"
`.replace("\\!", "!"),
    exists: (path) => path === "/Users/example/.fluent-frame/bin/native-host" || path === "/usr/local/bin/node",
    managedHostPath: "/Users/example/.fluent-frame/host/native-host/index.js",
  });

  assert.equal(result.wrapperTarget.ok, false);
  assert.equal(result.wrapperTarget.detail, "/deleted/worktree/apps/native-host/dist/index.js does not exist");
});

test("evaluateNativeHostRegistration rejects wrappers outside the managed host path", () => {
  const result = evaluateNativeHostRegistration({
    manifest: {
      path: "/Users/example/.fluent-frame/bin/native-host",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    },
    wrapperContent: `#\\!/bin/sh
exec "/usr/local/bin/node" "/repo/apps/native-host/dist/index.js"
`.replace("\\!", "!"),
    exists: () => true,
    managedHostPath: "/Users/example/.fluent-frame/host/native-host/index.js",
  });

  assert.equal(result.wrapperTarget.ok, false);
  assert.equal(
    result.wrapperTarget.detail,
    "/repo/apps/native-host/dist/index.js is not the managed host /Users/example/.fluent-frame/host/native-host/index.js",
  );
});

test("evaluateNativeHostRegistration rejects managed runtimes missing prompt assets", () => {
  const result = evaluateNativeHostRegistration({
    manifest: {
      path: "/Users/example/.fluent-frame/bin/native-host",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    },
    wrapperContent: `#\\!/bin/sh
exec "/usr/local/bin/node" "/Users/example/.fluent-frame/host/native-host/index.js"
`.replace("\\!", "!"),
    exists: (path) =>
      path === "/Users/example/.fluent-frame/bin/native-host" ||
      path === "/usr/local/bin/node" ||
      path === "/Users/example/.fluent-frame/host/native-host/index.js",
    managedHostPath: "/Users/example/.fluent-frame/host/native-host/index.js",
  });

  assert.equal(result.runtimePrompt.ok, false);
  assert.equal(
    result.runtimePrompt.detail,
    "/Users/example/.fluent-frame/host/native-host/prompts/youtube-learning-subtitles.md does not exist",
  );
});

test("evaluateNativeHostRegistration accepts a linked manifest and managed wrapper target", () => {
  const result = evaluateNativeHostRegistration({
    manifest: {
      path: "/Users/example/.fluent-frame/bin/native-host",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    },
    wrapperContent: `#\\!/bin/sh
exec "/usr/local/bin/node" "/Users/example/.fluent-frame/host/native-host/index.js"
`.replace("\\!", "!"),
    exists: () => true,
    nativeHostManifestLocation: "/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json",
    managedHostPath: "/Users/example/.fluent-frame/host/native-host/index.js",
  });

  assert.deepEqual(result, {
    manifest: {
      ok: true,
      detail:
        "/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json",
    },
    origin: { ok: true, detail: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/" },
    wrapper: { ok: true, detail: "/Users/example/.fluent-frame/bin/native-host" },
    node: { ok: true, detail: "/usr/local/bin/node" },
    wrapperTarget: { ok: true, detail: "/Users/example/.fluent-frame/host/native-host/index.js" },
    runtimePrompt: {
      ok: true,
      detail: "/Users/example/.fluent-frame/host/native-host/prompts/youtube-learning-subtitles.md",
    },
  });
});
