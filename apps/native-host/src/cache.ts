import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";

export const INVALID_CACHE_MESSAGE = "Invalid cached subtitle result";
const difficulties = new Set(["basic", "useful", "advanced"]);

function resultPath(cacheDir: string, videoId: string, captionLanguage: string): string {
  return join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION, "result.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidUsageNote(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    typeof value.question === "string" &&
    typeof value.explanation === "string"
  );
}

function isValidSubtitle(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.startMs === "number" &&
    typeof value.endMs === "number" &&
    typeof value.english === "string" &&
    typeof value.chinese === "string" &&
    isStringArray(value.phraseIds)
  );
}

function isValidPhrase(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.cueId === "number" &&
    typeof value.phrase === "string" &&
    typeof value.meaningZh === "string" &&
    typeof value.explanationEn === "string" &&
    typeof value.difficulty === "string" &&
    difficulties.has(value.difficulty) &&
    (value.noteZh === undefined || typeof value.noteZh === "string") &&
    (value.usageNotes === undefined || (Array.isArray(value.usageNotes) && value.usageNotes.every(isValidUsageNote)))
  );
}

function assertCachedResult(value: unknown): asserts value is LearningSubtitleResult {
  if (
    !isRecord(value) ||
    typeof value.videoId !== "string" ||
    typeof value.sourceLanguage !== "string" ||
    typeof value.workflowVersion !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.subtitles) ||
    value.subtitles.length === 0 ||
    !value.subtitles.every(isValidSubtitle) ||
    !Array.isArray(value.phrases) ||
    !value.phrases.every(isValidPhrase)
  ) {
    throw new Error(INVALID_CACHE_MESSAGE);
  }
  const subtitles = value.subtitles as LearningSubtitleResult["subtitles"];
  const phrases = value.phrases as LearningSubtitleResult["phrases"];
  const phraseIds = new Set(phrases.map((phrase) => phrase.id));
  const subtitleIds = new Set(subtitles.map((subtitle) => subtitle.id));
  if (
    !phrases.every((phrase) => subtitleIds.has(phrase.cueId)) ||
    !subtitles.every((subtitle) => subtitle.phraseIds.every((phraseId) => phraseIds.has(phraseId)))
  ) {
    throw new Error(INVALID_CACHE_MESSAGE);
  }
}

export async function readCachedResult(
  cacheDir: string,
  videoId: string,
  captionLanguage: string,
): Promise<LearningSubtitleResult | undefined> {
  try {
    const content = await readFile(resultPath(cacheDir, videoId, captionLanguage), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.videoId !== "string" ||
      typeof parsed.sourceLanguage !== "string" ||
      typeof parsed.workflowVersion !== "string"
    ) {
      throw new Error(INVALID_CACHE_MESSAGE);
    }
    if (
      parsed.videoId !== videoId ||
      parsed.sourceLanguage !== captionLanguage ||
      parsed.workflowVersion !== WORKFLOW_VERSION
    ) {
      return undefined;
    }
    assertCachedResult(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      throw new Error(INVALID_CACHE_MESSAGE);
    }
    throw error;
  }
}

export async function writeCachedResult(cacheDir: string, result: LearningSubtitleResult): Promise<void> {
  const path = resultPath(cacheDir, result.videoId, result.sourceLanguage);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export async function clearCachedResult(cacheDir: string, videoId: string, captionLanguage: string): Promise<void> {
  await rm(join(cacheDir, videoId, captionLanguage, WORKFLOW_VERSION), { recursive: true, force: true });
}
