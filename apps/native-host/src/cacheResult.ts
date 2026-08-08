import { type LearningSubtitleResult } from "@fluent-frame/shared";

export function hasCacheIdentity(value: unknown): value is Pick<LearningSubtitleResult, "videoId" | "sourceLanguage" | "workflowVersion"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Partial<LearningSubtitleResult>;
  return typeof result.videoId === "string"
    && typeof result.sourceLanguage === "string"
    && typeof result.workflowVersion === "string";
}

export function matchesCacheIdentity(
  value: unknown,
  videoId: string,
  captionLanguage: string,
  workflowVersion: string,
): value is LearningSubtitleResult {
  if (!hasCacheIdentity(value)) {
    return false;
  }
  return value.videoId === videoId
    && value.sourceLanguage === captionLanguage
    && value.workflowVersion === workflowVersion;
}
