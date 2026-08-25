import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonFileAtomically } from "./jsonFile.js";

function captionPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, "captions.json");
}

export async function readCachedCaptions(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(captionPath(cacheDir, videoId, captionLanguage), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const value = parsed as { captionText?: unknown };
    return typeof value.captionText === "string" && value.captionText.trim() ? value.captionText : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCachedCaptions(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
  captionText: string,
): Promise<void> {
  await writeJsonFileAtomically(captionPath(cacheDir, videoId, captionLanguage), {
    videoId,
    captionLanguage,
    cachedAt: new Date().toISOString(),
    captionText,
  });
}
