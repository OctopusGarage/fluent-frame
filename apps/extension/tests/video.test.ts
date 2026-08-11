import { describe, expect, it } from "vitest";
import { extractVideoIdFromUrl, findVideoElement } from "../src/video.js";

describe("extractVideoIdFromUrl", () => {
  it("extracts watch video ID", () => {
    expect(extractVideoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts mobile and short-link video IDs", () => {
    expect(extractVideoIdFromUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
    expect(extractVideoIdFromUrl("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
  });

  it("returns undefined when missing", () => {
    expect(extractVideoIdFromUrl("https://www.youtube.com/")).toBeUndefined();
    expect(extractVideoIdFromUrl("not a url")).toBeUndefined();
  });
});

describe("findVideoElement", () => {
  it("prefers the active YouTube player video over earlier preview videos", () => {
    document.body.replaceChildren();
    const previewVideo = document.createElement("video");
    const player = document.createElement("div");
    const mainVideo = document.createElement("video");
    player.className = "html5-video-player playing-mode";
    player.append(mainVideo);
    document.body.append(previewVideo, player);
    previewVideo.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    mainVideo.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });

    expect(findVideoElement()).toBe(mainVideo);
  });

  it("prefers the #movie_player video when multiple YouTube players exist", () => {
    document.body.replaceChildren();
    const hiddenPlayer = document.createElement("div");
    const hiddenVideo = document.createElement("video");
    const moviePlayer = document.createElement("div");
    const mainVideo = document.createElement("video");
    hiddenPlayer.className = "html5-video-player playing-mode";
    hiddenPlayer.append(hiddenVideo);
    moviePlayer.id = "movie_player";
    moviePlayer.className = "html5-video-player paused-mode";
    moviePlayer.append(mainVideo);
    document.body.append(hiddenPlayer, moviePlayer);

    expect(findVideoElement()).toBe(mainVideo);
  });

  it("prefers the visible largest player video over a small preview player", () => {
    document.body.replaceChildren();
    const previewPlayer = document.createElement("div");
    const previewVideo = document.createElement("video");
    const mainPlayer = document.createElement("div");
    const mainVideo = document.createElement("video");
    previewPlayer.className = "html5-video-player playing-mode";
    mainPlayer.className = "html5-video-player playing-mode";
    previewPlayer.append(previewVideo);
    mainPlayer.append(mainVideo);
    document.body.append(previewPlayer, mainPlayer);
    previewVideo.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 160,
      bottom: 90,
      width: 160,
      height: 90,
      toJSON: () => ({}),
    });
    mainVideo.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 960,
      bottom: 540,
      width: 960,
      height: 540,
      toJSON: () => ({}),
    });

    expect(findVideoElement()).toBe(mainVideo);
  });

  it("falls back to the first video when no YouTube player video exists", () => {
    document.body.replaceChildren();
    const video = document.createElement("video");
    document.body.append(video);

    expect(findVideoElement()).toBe(video);
  });
});
