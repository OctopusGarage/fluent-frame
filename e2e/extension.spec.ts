import { expect, test } from "@playwright/test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { extensionIdFromContext, launchExtensionContext, writeNativeHostManifests } from "./helpers.js";

async function installMockNativeHost(
  extensionId: string,
  dir: string,
  extraManifestDirs: string[] = [],
): Promise<() => Promise<void>> {
  const hostPath = join(dir, "mock-native-host.mjs");
  await writeFile(
    hostPath,
    `#!${process.execPath}
const chunks = [];
let done = false;
process.stdin.on("data", (chunk) => {
  if (done) {
    return;
  }
  chunks.push(chunk);
  const input = Buffer.concat(chunks);
  if (input.length < 4) {
    return;
  }
  const length = input.readUInt32LE(0);
  if (input.length < 4 + length) {
    return;
  }
  done = true;
  const request = JSON.parse(input.subarray(4, 4 + length).toString("utf8"));
  const response = request.type === "getPersonalNotes" ? {
    id: request.id,
    ok: true,
    type: "personalNotes",
    notes: []
  } : request.type === "savePersonalNotes" ? {
    id: request.id,
    ok: true,
    type: "personalNotesSaved"
  } : {
    id: request.id,
    ok: true,
    type: "result",
    result: {
      videoId: request.videoId,
      sourceLanguage: request.captionLanguage,
      workflowVersion: "e2e",
      generatedAt: "2026-07-18T00:00:00.000Z",
      subtitles: [
        {
          id: 1,
          startMs: 0,
          endMs: 3960,
          english: "Tonight we're in for an all-action affair,",
          chinese: "今晚必将是一场激烈大战，",
          phraseIds: ["phrase-1"]
        },
        {
          id: 2,
          startMs: 1960,
          endMs: 8120,
          english: "and may the best team win,",
          chinese: "愿更强的一方获胜，",
          phraseIds: ["phrase-2"]
        },
        {
          id: 3,
          startMs: 3960,
          endMs: 8120,
          english: "be it Spain or France.",
          chinese: "无论是西班牙还是法国。",
          phraseIds: ["phrase-3"]
        }
      ],
      phrases: [
        {
          id: "phrase-1",
          cueId: 1,
          phrase: "all-action affair",
          meaningZh: "激烈比赛",
          explanationEn: "A match with lots of action.",
          usageNotes: [
            {
              term: "affair",
              question: "Why use affair here?",
              explanation: "Here affair means an event or occasion, not a romantic relationship."
            }
          ],
          difficulty: "useful"
        },
        {
          id: "phrase-2",
          cueId: 2,
          phrase: "may the best team win",
          meaningZh: "愿强者胜",
          explanationEn: "A polite contest phrase.",
          difficulty: "basic"
        },
        {
          id: "phrase-3",
          cueId: 3,
          phrase: "be it Spain or France",
          meaningZh: "无论西班牙还是法国",
          explanationEn: "Means either option is possible.",
          difficulty: "useful"
        }
      ]
    }
  };
  const body = Buffer.from(JSON.stringify(response));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
  process.exit(0);
});
`,
    "utf8",
  );
  await chmod(hostPath, 0o755);

  return writeNativeHostManifests(
    extensionId,
    hostPath,
    "FluentFrame Playwright mock native host",
    extraManifestDirs,
  );
}

test("loads on YouTube SPA navigation and renders subtitles through native messaging", async () => {
  const extensionPath = resolve("apps/extension/dist");
  const discovery = await launchExtensionContext(extensionPath);
  const extensionId = await extensionIdFromContext(discovery.context);
  await discovery.context.close();
  await rm(discovery.userDataDir, { recursive: true, force: true });

  const hostDir = await mkdtemp(join(tmpdir(), "ff-native-host-"));
  const testUserDataDir = await mkdtemp(join(tmpdir(), "ff-playwright-"));
  const restoreNativeHost = await installMockNativeHost(extensionId, hostDir, [
    join(testUserDataDir, "NativeMessagingHosts"),
    join(testUserDataDir, "Default", "NativeMessagingHosts"),
  ]);
  const { context, userDataDir } = await launchExtensionContext(extensionPath, testUserDataDir);

  try {
    await context.route("https://www.youtube.com/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html>
          <html>
            <head><title>YouTube fixture</title></head>
            <body>
              <main id="content">
                <h1>Fixture home</h1>
                <div class="html5-video-player playing-mode" style="position:relative;width:960px;height:540px;">
                  <video controls style="width:960px;height:540px;"></video>
                  <div class="ytp-right-controls">
                    <button class="ytp-subtitles-button" type="button" aria-label="Subtitles"></button>
                    <button class="ytp-settings-button" type="button" aria-label="Settings"></button>
                  </div>
                </div>
              </main>
            </body>
          </html>`,
      });
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("https://www.youtube.com/");
    await expect(page.locator("#ff-panel")).toBeVisible();
    await expect(page.locator("#ff-status")).toHaveText("Ready");
    await expect(page.locator(".ytp-right-controls > #ff-video-badge + .ytp-subtitles-button")).toHaveCount(1);

    await page.getByRole("button", { name: "Generate learning subtitles" }).click();
    await expect(page.locator("#ff-status")).toHaveText("Open a YouTube video first.");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/watch?v=dQw4w9WgXcQ&t=42s");
    });
    await expect(page.locator("#ff-status")).toHaveText("Ready");

    await page.getByRole("button", { name: "Generate learning subtitles" }).click();
    await expect(page.locator("#ff-status")).toContainText("Learning subtitles ready in");
    await expect(page.locator("#ff-phrase-list")).toContainText("all-action affair");
    await expect(page.locator("#ff-phrase-list")).toContainText("激烈比赛");
    await expect(page.locator("#ff-phrase-list")).toContainText("Why use affair here?");
    await expect(page.locator("#ff-english")).toHaveText("Tonight we're in for an all-action affair,");
    await expect(page.locator("#ff-current-phrase")).toContainText("all-action affair");
    await expect(page.locator("#ff-root > #ff-panel")).toBeVisible();
    await expect(page.locator(".html5-video-player > #ff-panel")).toHaveCount(0);
    await expect(page.locator(".html5-video-player > #ff-video-now")).toBeVisible();
    await expect(page.locator(".html5-video-player > #ff-video-now")).toContainText("all-action affair");
    await expect(page.locator(".html5-video-player > #ff-video-now")).toContainText("激烈比赛");
    await expect(page.locator(".html5-video-player > #ff-video-now")).toContainText("may the best team win");
    await expect(page.locator(".html5-video-player > #ff-video-now")).toContainText("愿强者胜");
    await expect(page.locator(".html5-video-player > #ff-video-now .ff-video-now-item")).toHaveCount(3);
    await expect(page.locator(".html5-video-player > #ff-video-now .ff-video-now-line")).toHaveCount(6);
    await expect(page.locator(".html5-video-player > #ff-video-now")).not.toContainText("Tonight we're in for an all-action affair,");
    await expect(page.locator(".html5-video-player > #ff-video-now")).not.toContainText("今晚必将是一场激烈大战，");
    await expect(page.locator(".html5-video-player > #ff-video-now")).not.toContainText("A match with lots of action.");
    await expect(page.locator(".html5-video-player > #ff-video-now")).not.toContainText("Why use affair here?");
    await page.locator("#ff-toggle-now").click();
    await expect(page.locator(".html5-video-player > #ff-video-now")).toBeHidden();
    await page.locator("#ff-toggle-now").click();
    await expect(page.locator(".html5-video-player > #ff-video-now")).toBeVisible();
    await page.locator('#ff-root [data-now-size="large"]').click();
    await expect(page.locator(".html5-video-player > #ff-video-now")).toHaveAttribute("data-now-size", "large");
    await page.locator('#ff-root [data-layout-option="toolbar"]').click();
    await expect(page.locator("#ff-status")).toBeVisible();
    await expect(page.locator("#ff-status")).toContainText("Learning subtitles ready in");

    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!(video instanceof HTMLVideoElement)) {
        throw new Error("Missing fixture video");
      }
      video.currentTime = 2.5;
    });
    await expect(page.locator("#ff-english")).toHaveText("and may the best team win,");
    await expect(page.locator("#ff-chinese")).toHaveText("愿更强的一方获胜，");
    await expect(page.locator("#ff-current-phrase")).toContainText("may the best team win");
    await expect(page.locator("#ff-current-phrase .ff-current-phrase-item")).toHaveCount(3);

    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (!(video instanceof HTMLVideoElement)) {
        throw new Error("Missing fixture video");
      }
      video.currentTime = 4.2;
    });
    await expect(page.locator("#ff-english")).toHaveText("be it Spain or France.");
    await expect(page.locator("#ff-chinese")).toHaveText("无论是西班牙还是法国。");
    await expect(page.locator("#ff-current-phrase")).toContainText("be it Spain or France");

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole("button", { name: "Generate learning subtitles" })).toBeVisible();
  } finally {
    await restoreNativeHost();
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(hostDir, { recursive: true, force: true });
  }
});
