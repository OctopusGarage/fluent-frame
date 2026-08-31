export function isProtocolObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function parseYoutubeVideoId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value)) {
    throw new Error("Invalid YouTube video ID");
  }
  return value;
}

export function parseCaptionLanguage(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(value)) {
    throw new Error("Invalid caption language");
  }
  return value;
}

export function parseNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}
