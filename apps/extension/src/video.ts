const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function validVideoId(value: string | null | undefined): string | undefined {
  return value && YOUTUBE_VIDEO_ID_PATTERN.test(value) ? value : undefined;
}

export function extractVideoIdFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const id = host === "youtu.be"
      ? pathParts[0]
      : pathParts[0] === "shorts"
        ? pathParts[1]
        : parsed.searchParams.get("v");
    return validVideoId(id);
  } catch {
    return undefined;
  }
}

export function findVideoElement(): HTMLVideoElement | undefined {
  const moviePlayerVideo = document.querySelector("#movie_player video");
  if (moviePlayerVideo instanceof HTMLVideoElement) {
    return moviePlayerVideo;
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLVideoElement>(
      ".html5-video-player.playing-mode video,.html5-video-player.paused-mode video,.html5-video-player video,video",
    ),
  );
  return candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
  })[0];
}
