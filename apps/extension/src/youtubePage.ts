import { extractVideoIdFromUrl, findVideoElement } from "./video.js";

export type YouTubePage = {
  currentVideoId(): string | undefined;
  mainVideo(): HTMLVideoElement | undefined;
};

export function createYouTubePage(doc: Document): YouTubePage {
  return {
    currentVideoId() {
      return extractVideoIdFromUrl(doc.location.href);
    },
    mainVideo() {
      return findVideoElement();
    },
  };
}
