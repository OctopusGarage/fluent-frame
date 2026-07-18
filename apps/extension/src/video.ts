export function extractVideoIdFromUrl(url: string): string | undefined {
  const parsed = new URL(url);
  const id = parsed.searchParams.get("v");
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
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
