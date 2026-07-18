import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { extensionIdFromContext, launchExtensionContext, writeNativeHostManifests } from "./helpers.js";

const execFileAsync = promisify(execFile);
const LIVE_VIDEO_URL = process.env.FF_LIVE_YOUTUBE_URL ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const LIVE_VIDEO_ID = new URL(LIVE_VIDEO_URL).searchParams.get("v") ?? "dQw4w9WgXcQ";

test.skip(process.env.FF_LIVE_YOUTUBE !== "1", "Set FF_LIVE_YOUTUBE=1 to run the live YouTube/native-host e2e.");
test.setTimeout(360_000);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function seekMainYouTubeVideo(page: import("@playwright/test").Page, seconds: number): Promise<void> {
  await page.evaluate((nextSeconds) => {
    const video = document.querySelector("#movie_player video")
      ?? document.querySelector(".html5-video-player video")
      ?? document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error("Missing YouTube video element");
    }
    video.currentTime = nextSeconds;
    video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  }, seconds);
  await expect.poll(async () => {
    return page.evaluate(() => {
      const video = document.querySelector("#movie_player video")
        ?? document.querySelector(".html5-video-player video")
        ?? document.querySelector("video");
      return video instanceof HTMLVideoElement ? video.currentTime : -1;
    });
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(seconds - 0.25);
}

async function resolveCommandPath(command: string, envValue: string | undefined): Promise<string> {
  const trimmedEnvValue = envValue?.trim();
  if (trimmedEnvValue) {
    return trimmedEnvValue;
  }
  const { stdout } = await execFileAsync("/usr/bin/env", ["sh", "-lc", `command -v ${command}`]);
  const resolvedPath = stdout.trim().split("\n")[0];
  if (!resolvedPath) {
    throw new Error(`${command} not found on PATH`);
  }
  return resolvedPath;
}

async function installRealNativeHost(extensionId: string, dir: string, userDataDir: string): Promise<() => Promise<void>> {
  const ytDlpPath = await resolveCommandPath("yt-dlp", process.env.FF_YTDLP_PATH);
  const codexPath = await resolveCommandPath("codex", process.env.FF_CODEX_PATH);
  const hostPath = resolve("apps/native-host/dist/index.js");
  const cacheDir = join(dir, "cache");
  const wrapperPath = join(dir, "native-host");
  const pathEntries = [
    dirname(process.execPath),
    dirname(ytDlpPath),
    dirname(codexPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter((entry, index, entries) => entries.indexOf(entry) === index);
  await writeFile(
    wrapperPath,
    `#!/bin/sh
export PATH=${shellQuote(`${pathEntries.join(delimiter)}:$PATH`)}
export FF_YTDLP_PATH=${shellQuote(ytDlpPath)}
export FF_CODEX_PATH=${shellQuote(codexPath)}
export FF_CACHE_DIR=${shellQuote(cacheDir)}
exec "${process.execPath}" "${hostPath}"
`,
    "utf8",
  );
  await chmod(wrapperPath, 0o755);
  return writeNativeHostManifests(extensionId, wrapperPath, "FluentFrame live Playwright native host", [
    join(userDataDir, "NativeMessagingHosts"),
    join(userDataDir, "Default", "NativeMessagingHosts"),
  ]);
}

test("generates subtitles on a real YouTube watch page through the real native host", async () => {
  const extensionPath = resolve("apps/extension/dist");
  const discovery = await launchExtensionContext(extensionPath);
  const extensionId = await extensionIdFromContext(discovery.context);
  await discovery.context.close();
  await rm(discovery.userDataDir, { recursive: true, force: true });

  const testUserDataDir = await mkdtemp(join(tmpdir(), "ff-live-playwright-"));
  const nativeHostDir = await mkdtemp(join(tmpdir(), "ff-live-native-host-"));
  const restoreNativeHost = await installRealNativeHost(extensionId, nativeHostDir, testUserDataDir);
  const { context, userDataDir } = await launchExtensionContext(extensionPath, testUserDataDir);

  try {
    await expect.poll(async () => extensionIdFromContext(context)).toBe(extensionId);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(LIVE_VIDEO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await expect(page.locator("#ff-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#ff-status")).toHaveText("Ready");

    await page.getByRole("button", { name: "Generate learning subtitles" }).click();
    await expect(page.locator("#ff-status")).toContainText("Learning subtitles ready", { timeout: 300_000 });
    await expect(page.locator("#ff-english")).not.toHaveText("");
    await expect(page.locator("#ff-current-phrase")).not.toHaveText("");

    const initialSubtitle = await page.locator("#ff-english").textContent();
    const initialCurrentPhrase = await page.locator("#ff-current-phrase").textContent();
    await seekMainYouTubeVideo(page, 26);
    await expect(page.locator("#ff-english")).not.toHaveText(initialSubtitle ?? "", { timeout: 10_000 });
    await expect(page.locator("#ff-english")).not.toHaveText("");
    await expect(page.locator("#ff-current-phrase")).not.toHaveText(initialCurrentPhrase ?? "", { timeout: 10_000 });
    await expect(page.locator("#ff-current-phrase")).not.toHaveText("");
    await expect(page.locator("#ff-current-phrase")).not.toContainText("Translation pending");

    if (process.env.FF_E2E_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.FF_E2E_SCREENSHOT_PATH, fullPage: false });
    }

    await seekMainYouTubeVideo(page, 300);
    await expect(page.locator("#ff-english")).not.toHaveText("", { timeout: 10_000 });
    await expect(page.locator("#ff-current-phrase")).not.toHaveText("", { timeout: 10_000 });

    await expect(page.locator("#ff-root")).toHaveAttribute("data-overlay-hidden", "false");

    const generatedVideoId = await page.evaluate(() => new URL(window.location.href).searchParams.get("v"));
    expect(generatedVideoId).toBe(LIVE_VIDEO_ID);
  } finally {
    await restoreNativeHost();
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(nativeHostDir, { recursive: true, force: true });
  }
});
