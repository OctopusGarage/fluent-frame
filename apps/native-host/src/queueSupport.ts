import { readCachedResult, writeCachedResult } from "./cache.js";
import type { HostConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createRemoteCacheProvider } from "./remoteCache.js";
import { fetchVideoTitle } from "./videoMetadata.js";

export async function cacheReady(
  config: HostConfig,
  input: { videoId: string; captionLanguage: string },
): Promise<boolean> {
  try {
    if (await readCachedResult(config.cacheDir, input.videoId, input.captionLanguage)) {
      return true;
    }
    const remoteResult = await createRemoteCacheProvider(config.remoteCache)?.readResult(
      input.videoId,
      input.captionLanguage,
    );
    if (!remoteResult) {
      return false;
    }
    await writeCachedResult(config.cacheDir, remoteResult);
    return true;
  } catch {
    return false;
  }
}

export async function resolveVideoTitle(
  config: HostConfig,
  videoId: string,
  title: string | undefined,
): Promise<string | undefined> {
  if (title?.trim()) {
    return title.trim();
  }
  const logger = createLogger(config.logFile);
  try {
    const resolved = await fetchVideoTitle(videoId, config.ytDlpPath);
    await logger.log({
      level: resolved ? "info" : "warn",
      component: "videoMetadata",
      event: resolved ? "title.resolved" : "title.empty",
      message: resolved ? "Resolved YouTube video title" : "YouTube title metadata was empty",
      videoId,
      details: { title: resolved },
    });
    return resolved;
  } catch (error) {
    await logger.log({
      level: "warn",
      component: "videoMetadata",
      event: "title.failed",
      message: "Failed to resolve YouTube video title",
      videoId,
      details: { error },
    });
    return undefined;
  }
}
