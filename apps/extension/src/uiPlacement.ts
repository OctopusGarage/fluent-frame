import { setStyle } from "./domStyle.js";

export type UiPlacementController = {
  updatePlayerState(video?: HTMLVideoElement): HTMLElement | undefined;
  placeVideoNow(player: HTMLElement | undefined): void;
  placeSubtitleOverlay(video?: HTMLVideoElement): void;
  attachPlayerButton(video?: HTMLVideoElement): void;
};

export type UiPlacementDeps = {
  doc: Document;
  root: HTMLElement;
  overlay: HTMLElement;
  videoNow: HTMLElement;
  panelToggle: HTMLElement;
  hasResult(): boolean;
  activeWindowKey(): string;
  setActiveWindowKey(value: string): void;
  renderCueWindowEmpty(): void;
};

function findPlayer(doc: Document, video?: HTMLVideoElement): HTMLElement | undefined {
  const player = video?.closest(".html5-video-player")
    ?? doc.querySelector(".html5-video-player.playing-mode,.html5-video-player.paused-mode,.html5-video-player");
  return player instanceof HTMLElement ? player : undefined;
}

function isShortsPlayer(doc: Document, player: HTMLElement): boolean {
  return Boolean(player.closest("#shorts-player,#player-shorts-container") ?? doc.querySelector("#shorts-player,#player-shorts-container"));
}

function hasVisibleAd(player: HTMLElement): boolean {
  const adOverlay = player.querySelector(".ytp-ad-player-overlay");
  return adOverlay instanceof HTMLElement && !adOverlay.hidden;
}

export function createUiPlacementController(deps: UiPlacementDeps): UiPlacementController {
  let attachedPlayer: HTMLElement | undefined;

  function setNativeCaptionSuppression(player: HTMLElement | undefined, suppress: boolean): void {
    if (attachedPlayer && attachedPlayer !== player) {
      attachedPlayer.classList.remove("ff-hide-native-captions");
    }
    attachedPlayer = player;
    if (!player) {
      return;
    }
    player.classList.toggle("ff-hide-native-captions", suppress);
  }

  function restorePageBadge(): void {
    const badge = deps.panelToggle;
    if (badge.parentElement !== deps.root) {
      deps.root.insertBefore(badge, deps.root.firstChild);
    }
    badge.classList.remove("ff-in-player-controls");
    badge.classList.remove("ff-in-shorts-controls");
    setStyle(badge, "left", "");
    setStyle(badge, "top", "");
    setStyle(badge, "right", "");
    setStyle(badge, "bottom", "");
  }

  return {
    updatePlayerState(video) {
      const player = findPlayer(deps.doc, video);
      const adPlayback = Boolean(player && hasVisibleAd(player));
      deps.root.dataset.adPlayback = String(adPlayback);
      if (player && isShortsPlayer(deps.doc, player)) {
        deps.root.dataset.videoMode = "shorts";
      } else {
        delete deps.root.dataset.videoMode;
      }
      setNativeCaptionSuppression(
        player,
        Boolean(deps.hasResult() && deps.root.dataset.overlayHidden !== "true" && !adPlayback),
      );
      if (adPlayback) {
        deps.setActiveWindowKey("ad");
        deps.renderCueWindowEmpty();
      } else if (deps.activeWindowKey() === "ad") {
        deps.setActiveWindowKey("");
      }
      return player;
    },
    placeVideoNow(player) {
      const showInVideo = Boolean(
        player
          && deps.hasResult()
          && deps.root.dataset.layout !== "drawer"
          && deps.root.dataset.panelCollapsed !== "true"
          && deps.root.dataset.nowPaneHidden !== "true"
          && deps.videoNow.childElementCount > 0,
      );
      if (showInVideo && player) {
        if (deps.videoNow.parentElement !== player) {
          player.appendChild(deps.videoNow);
        }
        deps.videoNow.classList.add("ff-video-now-in-player");
        deps.videoNow.hidden = false;
        if (deps.root.dataset.videoNowDragged !== "true") {
          setStyle(deps.videoNow, "left", "");
          setStyle(deps.videoNow, "top", "96px");
          setStyle(deps.videoNow, "right", "14px");
          setStyle(deps.videoNow, "bottom", "auto");
        }
        return;
      }
      deps.videoNow.hidden = true;
      deps.videoNow.classList.remove("ff-video-now-in-player");
      if (deps.videoNow.parentElement !== deps.root) {
        deps.root.appendChild(deps.videoNow);
      }
    },
    placeSubtitleOverlay(video) {
      if (!video || deps.root.dataset.subtitleDragged === "true") {
        return;
      }
      const player = this.updatePlayerState(video);
      this.placeVideoNow(player);
      deps.overlay.hidden = deps.root.dataset.overlayHidden === "true";
      if (player) {
        if (deps.overlay.parentElement !== player) {
          player.appendChild(deps.overlay);
        }
        deps.overlay.classList.add("ff-overlay-in-player");
        setStyle(deps.overlay, "width", "90%");
        setStyle(deps.overlay, "left", "50%");
        setStyle(deps.overlay, "right", "auto");
        setStyle(deps.overlay, "top", "24px");
        setStyle(deps.overlay, "bottom", "auto");
        setStyle(deps.overlay, "transform", "translateX(-50%)");
        return;
      }
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        restorePageBadge();
        return;
      }
      const width = Math.min(rect.width * 0.92, 920);
      const topSafeOffset = Math.max(18, Math.min(28, rect.height * 0.06));
      deps.overlay.classList.remove("ff-overlay-in-player");
      setStyle(deps.overlay, "width", `${Math.round(width)}px`);
      setStyle(deps.overlay, "left", `${Math.round(rect.left + rect.width / 2)}px`);
      setStyle(deps.overlay, "top", `${Math.round(rect.top + topSafeOffset)}px`);
      setStyle(deps.overlay, "right", "auto");
      setStyle(deps.overlay, "bottom", "auto");
      setStyle(deps.overlay, "transform", "translateX(-50%)");
    },
    attachPlayerButton(video) {
      const badge = deps.panelToggle;
      const shortsControls = deps.doc.querySelector("#right-controls");
      const controls = shortsControls ?? deps.doc.querySelector(".ytp-right-controls");
      if (controls instanceof HTMLElement) {
        const insertBeforeElement = shortsControls
          ? controls.firstElementChild
          : controls.querySelector(".ytp-subtitles-button");
        const directInsertBeforeElement = insertBeforeElement?.parentElement === controls && insertBeforeElement !== badge
          ? insertBeforeElement
          : undefined;
        if (directInsertBeforeElement) {
          if (badge.nextElementSibling !== directInsertBeforeElement) {
            controls.insertBefore(badge, directInsertBeforeElement);
          }
        } else if (badge.parentElement !== controls || controls.firstElementChild !== badge) {
          controls.insertBefore(badge, controls.firstElementChild);
        }
        badge.classList.add("ff-in-player-controls");
        badge.classList.toggle("ff-in-shorts-controls", Boolean(shortsControls));
        setStyle(badge, "left", "");
        setStyle(badge, "top", "");
        setStyle(badge, "right", "");
        setStyle(badge, "bottom", "");
        return;
      }
      if (!video) {
        restorePageBadge();
        return;
      }
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      restorePageBadge();
      setStyle(badge, "left", `${Math.round(rect.right - 76)}px`);
      setStyle(badge, "top", `${Math.round(rect.bottom - 46)}px`);
      setStyle(badge, "right", "auto");
      setStyle(badge, "bottom", "auto");
    },
  };
}
