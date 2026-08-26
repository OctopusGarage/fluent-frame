import { NATIVE_HOST_NAME } from "../packages/shared/dist/index.js";
import { chromium, type BrowserContext } from "@playwright/test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

export async function launchExtensionContext(
  extensionPath: string,
  userDataDir = "",
): Promise<{ context: BrowserContext; userDataDir: string }> {
  const resolvedUserDataDir = userDataDir || (await mkdtemp(join(tmpdir(), "ff-playwright-")));
  const context = await chromium.launchPersistentContext(resolvedUserDataDir, {
    channel: process.env.PLAYWRIGHT_CHROME_CHANNEL ?? "chromium",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  return { context, userDataDir: resolvedUserDataDir };
}

export async function extensionIdFromContext(context: BrowserContext): Promise<string> {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  const extensionId = serviceWorker.url().split("/")[2];
  if (!extensionId) {
    throw new Error(`Could not read extension ID from ${serviceWorker.url()}`);
  }
  return extensionId;
}

export function nativeHostManifestDirs(extraManifestDirs: string[] = []): string[] {
  return [
    join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Google", "ChromeForTesting", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Chromium", "NativeMessagingHosts"),
    ...extraManifestDirs,
  ];
}

export async function writeNativeHostManifests(
  extensionId: string,
  hostPath: string,
  description: string,
  extraManifestDirs: string[] = [],
): Promise<() => Promise<void>> {
  const manifestPaths = nativeHostManifestDirs(extraManifestDirs).map((manifestDir) =>
    join(manifestDir, `${NATIVE_HOST_NAME}.json`),
  );
  const originalManifests = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      try {
        return await readFile(manifestPath, "utf8");
      } catch {
        return undefined;
      }
    }),
  );

  await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      await mkdir(join(manifestPath, ".."), { recursive: true });
      await writeFile(
        manifestPath,
        `${JSON.stringify(
          {
            name: NATIVE_HOST_NAME,
            description,
            path: hostPath,
            type: "stdio",
            allowed_origins: [`chrome-extension://${extensionId}/`],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }),
  );

  return async () => {
    await Promise.all(
      manifestPaths.map(async (manifestPath, index) => {
        const originalManifest = originalManifests[index];
        if (originalManifest === undefined) {
          await rm(manifestPath, { force: true });
          return;
        }
        await writeFile(manifestPath, originalManifest, "utf8");
      }),
    );
  };
}
