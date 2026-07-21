import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";

let dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
  dirs = [];
});

async function writeConfig(config: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ff-config-"));
  dirs.push(dir);
  await mkdir(join(dir, ".fluent-frame"), { recursive: true });
  await writeFile(join(dir, ".fluent-frame", "config.json"), JSON.stringify(config), "utf8");
  return dir;
}

describe("loadHostConfig", () => {
  it("parses reusable GitHub remote cache configuration without storing token values", async () => {
    const home = await writeConfig({
      remoteCache: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: true,
        tokenEnv: "FF_GITHUB_TOKEN",
      },
    });

    const config = loadHostConfig({ HOME: home, FF_GITHUB_TOKEN: "secret-token" });

    expect(config.remoteCache).toEqual({
      enabled: true,
      provider: "github",
      owner: "octo",
      repo: "cache",
      branch: "main",
      basePath: "data/youtube",
      writeEnabled: true,
      tokenEnv: "FF_GITHUB_TOKEN",
      token: "secret-token",
    });
  });

  it("disables invalid remote cache configuration instead of failing startup", async () => {
    const home = await writeConfig({
      remoteCache: {
        enabled: true,
        provider: "github",
        owner: "../bad",
        repo: "cache",
      },
    });

    const config = loadHostConfig({ HOME: home });

    expect(config.remoteCache).toEqual({ enabled: false });
  });

  it("accepts GitHub remote cache configuration from environment for detached workers", () => {
    const config = loadHostConfig({
      HOME: "/tmp/fluent-frame-home",
      FF_REMOTE_CACHE_PROVIDER: "github",
      FF_REMOTE_CACHE_OWNER: "octo",
      FF_REMOTE_CACHE_REPO: "cache",
      FF_REMOTE_CACHE_BRANCH: "main",
      FF_REMOTE_CACHE_BASE_PATH: "data/youtube",
      FF_REMOTE_CACHE_WRITE_ENABLED: "true",
      FF_REMOTE_CACHE_TOKEN_ENV: "FF_GITHUB_TOKEN",
      FF_GITHUB_TOKEN: "secret-token",
    });

    expect(config.remoteCache).toEqual({
      enabled: true,
      provider: "github",
      owner: "octo",
      repo: "cache",
      branch: "main",
      basePath: "data/youtube",
      writeEnabled: true,
      tokenEnv: "FF_GITHUB_TOKEN",
      token: "secret-token",
    });
  });
});
