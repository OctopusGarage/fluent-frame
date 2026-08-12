const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined): string | undefined {
  return value && YOUTUBE_VIDEO_ID_PATTERN.test(value) ? value : undefined;
}

export function extractYoutubeVideoIdFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "shorts") {
        return validVideoId(pathParts[1]);
      }
      return validVideoId(parsed.searchParams.get("v"));
    }
    if (host === "youtu.be") {
      return validVideoId(parsed.pathname.split("/").filter(Boolean)[0]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
