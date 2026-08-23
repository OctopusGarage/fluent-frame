import { describe, expect, it } from "vitest";
import { NATIVE_HOST_NAME } from "@fluent-frame/shared";
import {
  buildManagedHostRuntimeInstallPlan,
  buildNativeHostManifest,
  buildNativeHostWrapper,
  assertManagedHostRuntime,
  PLACEHOLDER_ALLOWED_ORIGIN,
  resolveManagedHostPath,
  resolveAllowedOrigins,
  resolveExtensionId,
} from "../src/scripts/install-native-host.js";

describe("native host installer", () => {
  it("uses the placeholder origin on first install without an extension ID", () => {
    expect(resolveAllowedOrigins()).toEqual([PLACEHOLDER_ALLOWED_ORIGIN]);
  });

  it("uses an explicit extension ID origin", () => {
    expect(resolveAllowedOrigins(undefined, "abcdefghijklmnopabcdefghijklmnop")).toEqual([
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
    ]);
  });

  it("resolves extension ID from CLI args before env", () => {
    expect(resolveExtensionId(["--extension-id", "cliabcdefghijklmnopabcdefghijkl"], { FF_EXTENSION_ID: "env" })).toBe(
      "cliabcdefghijklmnopabcdefghijkl",
    );
    expect(resolveExtensionId([], { FF_EXTENSION_ID: "envabcdefghijklmnopabcdefghijkl" })).toBe(
      "envabcdefghijklmnopabcdefghijkl",
    );
  });

  it("preserves existing non-placeholder origins when rerunning without an extension ID", () => {
    const existingManifest = buildNativeHostManifest("/Users/example/bin/native-host", [
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
    ]);

    expect(resolveAllowedOrigins(existingManifest)).toEqual(["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]);
  });

  it("builds the manifest with resolved allowed origins", () => {
    expect(
      buildNativeHostManifest("/Users/example/.fluent-frame/bin/native-host", [
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop/",
      ]),
    ).toEqual({
      name: NATIVE_HOST_NAME,
      description: "FluentFrame local native host",
      path: "/Users/example/.fluent-frame/bin/native-host",
      type: "stdio",
      allowed_origins: ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
    });
  });

  it("uses a stable managed native host path outside transient worktrees", () => {
    expect(resolveManagedHostPath("/repo/apps/native-host/dist/scripts/install-native-host.js", "/Users/example")).toBe(
      "/Users/example/.fluent-frame/host/native-host/index.js",
    );
  });

  it("copies prompt assets into the managed native host runtime", () => {
    expect(buildManagedHostRuntimeInstallPlan("/repo/apps/native-host/dist", "/Users/example/.fluent-frame/host/native-host")).toContainEqual({
      from: "/repo/apps/native-host/prompts",
      to: "/Users/example/.fluent-frame/host/native-host/prompts",
      recursive: true,
    });
  });

  it("rejects managed native host runtimes missing prompt assets", () => {
    expect(() =>
      assertManagedHostRuntime("/Users/example/.fluent-frame/host/native-host", (path) =>
        path === "/Users/example/.fluent-frame/host/native-host/index.js"
      ),
    ).toThrow(
      "Managed native host runtime is incomplete: /Users/example/.fluent-frame/host/native-host/prompts/youtube-learning-subtitles.md",
    );
  });

  it("accepts managed native host runtimes with prompt assets", () => {
    expect(() =>
      assertManagedHostRuntime("/Users/example/.fluent-frame/host/native-host", (path) =>
        path === "/Users/example/.fluent-frame/host/native-host/index.js" ||
        path === "/Users/example/.fluent-frame/host/native-host/prompts/youtube-learning-subtitles.md"
      ),
    ).not.toThrow();
  });

  it("builds wrapper content with the current node executable and compiled host path", () => {
    const nodeBinDir = process.execPath.slice(0, process.execPath.lastIndexOf("/"));
    expect(buildNativeHostWrapper("/repo/apps/native-host/dist/index.js")).toBe(`#\\!/bin/sh
export PATH='${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH'
exec "${process.execPath}" "/repo/apps/native-host/dist/index.js"
`.replace("\\!", "!"));
  });

  it("builds wrapper content with resolved tool path exports", () => {
    expect(
      buildNativeHostWrapper({
        hostPath: "/repo/apps/native-host/dist/index.js",
        agent: "claude",
        ytDlpPath: "/opt/homebrew/bin/yt-dlp",
        codexPath: "/Users/example/bin/codex's cli",
        claudePath: "/Users/example/bin/claude",
      }),
    ).toBe(`#\\!/bin/sh
export PATH='${process.execPath.slice(0, process.execPath.lastIndexOf("/"))}:/opt/homebrew/bin:/Users/example/bin:/usr/local/bin:/usr/bin:/bin:$PATH'
export FF_AGENT='claude'
export FF_YTDLP_PATH='/opt/homebrew/bin/yt-dlp'
export FF_CODEX_PATH='/Users/example/bin/codex'\\''s cli'
export FF_CLAUDE_PATH='/Users/example/bin/claude'
exec "${process.execPath}" "/repo/apps/native-host/dist/index.js"
`.replace("\\!", "!"));
  });
});
