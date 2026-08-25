import {
  applyPosition,
  elementPosition,
  resetPosition,
} from "./domStyle.js";
import {
  clearUiState,
  isLayoutMode,
  isNowPaneSize,
  readUiState,
  type LayoutMode,
  type NowPaneSize,
  writeUiState,
} from "./uiPersistence.js";

export type UiLayoutController = {
  applySaved(): void;
  persist(): void;
  reset(): void;
  setLayout(layout: LayoutMode): void;
  setPanelCollapsed(collapsed: boolean): void;
  togglePanel(): void;
  toggleOverlay(): void;
  toggleVideoNow(): void;
  setNowSize(size: NowPaneSize): void;
};

export type UiLayoutControllerDeps = {
  win: Window | null;
  root: HTMLElement;
  panel: HTMLElement;
  overlay: HTMLElement;
  videoNow: HTMLElement;
  panelToggle: HTMLElement;
};

export function createUiLayoutController(deps: UiLayoutControllerDeps): UiLayoutController {
  let loadedUiState = readUiState(deps.win);

  function persist(): void {
    writeUiState(deps.win, {
      layout: isLayoutMode(deps.root.dataset.layout) ? deps.root.dataset.layout : "panel",
      panelCollapsed: deps.root.dataset.panelCollapsed === "true",
      overlayHidden: deps.root.dataset.overlayHidden === "true",
      nowPaneHidden: deps.root.dataset.nowPaneHidden === "true",
      nowSize: isNowPaneSize(deps.root.dataset.nowSize) ? deps.root.dataset.nowSize : "medium",
      panelDragged: deps.root.dataset.dragged === "true",
      subtitleDragged: deps.root.dataset.subtitleDragged === "true",
      videoNowDragged: deps.root.dataset.videoNowDragged === "true",
      panelPosition: elementPosition(deps.panel),
      overlayPosition: elementPosition(deps.overlay),
      videoNowPosition: elementPosition(deps.videoNow),
    });
  }

  function setLayout(layout: LayoutMode, shouldPersist = true): void {
    deps.root.dataset.layout = layout;
    if (layout !== "panel") {
      delete deps.root.dataset.dragged;
      resetPosition(deps.panel);
    }
    deps.root.querySelectorAll<HTMLButtonElement>("[data-layout-option]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.layoutOption === layout));
    });
    if (shouldPersist) {
      persist();
    }
  }

  function setPanelCollapsed(collapsed: boolean, shouldPersist = true): void {
    deps.root.dataset.panelCollapsed = String(collapsed);
    deps.videoNow.hidden = collapsed;
    deps.panelToggle.setAttribute("aria-label", collapsed ? "Show FluentFrame pane" : "Hide FluentFrame pane");
    deps.panelToggle.setAttribute("title", collapsed ? "Show FluentFrame" : "Hide FluentFrame");
    if (collapsed) {
      deps.panel.setAttribute("aria-hidden", "true");
    } else {
      deps.panel.removeAttribute("aria-hidden");
    }
    if (shouldPersist) {
      persist();
    }
  }

  function setOverlayHidden(hidden: boolean, shouldPersist = true): void {
    deps.root.dataset.overlayHidden = String(hidden);
    deps.overlay.hidden = hidden;
    const toggle = deps.root.querySelector<HTMLButtonElement>("#ff-toggle-overlay");
    const title = toggle?.querySelector(".ff-command-title");
    const meta = toggle?.querySelector(".ff-command-meta");
    if (title) {
      title.textContent = "Subtitles";
    }
    if (meta) {
      meta.textContent = hidden ? "Hidden" : "Visible";
    }
    toggle?.setAttribute("aria-pressed", String(hidden));
    if (shouldPersist) {
      persist();
    }
  }

  function setNowPaneHidden(hidden: boolean, shouldPersist = true): void {
    deps.root.dataset.nowPaneHidden = String(hidden);
    deps.videoNow.hidden = hidden;
    const toggle = deps.root.querySelector<HTMLButtonElement>("#ff-toggle-now");
    const meta = toggle?.querySelector(".ff-command-meta");
    if (meta) {
      meta.textContent = hidden ? "Hidden" : "Visible";
    }
    toggle?.setAttribute("aria-pressed", String(hidden));
    if (shouldPersist) {
      persist();
    }
  }

  function setNowSize(size: NowPaneSize, shouldPersist = true): void {
    deps.root.dataset.nowSize = size;
    deps.videoNow.dataset.nowSize = size;
    deps.root.querySelectorAll<HTMLButtonElement>("[data-now-size]").forEach((sizeButton) => {
      sizeButton.setAttribute("aria-pressed", String(sizeButton.dataset.nowSize === size));
    });
    if (shouldPersist) {
      persist();
    }
  }

  return {
    applySaved() {
      const state = loadedUiState;
      if (isLayoutMode(state.layout)) {
        setLayout(state.layout, false);
      }
      if (typeof state.panelCollapsed === "boolean") {
        setPanelCollapsed(state.panelCollapsed, false);
      }
      if (typeof state.overlayHidden === "boolean") {
        setOverlayHidden(state.overlayHidden, false);
      }
      if (typeof state.nowPaneHidden === "boolean") {
        setNowPaneHidden(state.nowPaneHidden, false);
      }
      if (isNowPaneSize(state.nowSize)) {
        setNowSize(state.nowSize, false);
      }
      if (state.panelDragged) {
        deps.root.dataset.dragged = "true";
        applyPosition(deps.panel, state.panelPosition);
      }
      if (state.subtitleDragged) {
        deps.root.dataset.subtitleDragged = "true";
        applyPosition(deps.overlay, state.overlayPosition);
      }
      if (state.videoNowDragged) {
        deps.root.dataset.videoNowDragged = "true";
        applyPosition(deps.videoNow, state.videoNowPosition);
      }
    },
    persist,
    reset() {
      clearUiState(deps.win);
      loadedUiState = {};
      delete deps.root.dataset.dragged;
      delete deps.root.dataset.subtitleDragged;
      delete deps.root.dataset.videoNowDragged;
      resetPosition(deps.panel);
      resetPosition(deps.overlay);
      resetPosition(deps.videoNow);
      setLayout("panel", false);
      setPanelCollapsed(false, false);
      setOverlayHidden(false, false);
      setNowPaneHidden(false, false);
      setNowSize("medium", false);
    },
    setLayout,
    setPanelCollapsed,
    togglePanel() {
      setPanelCollapsed(deps.root.dataset.panelCollapsed !== "true");
    },
    toggleOverlay() {
      setOverlayHidden(deps.root.dataset.overlayHidden !== "true");
    },
    toggleVideoNow() {
      setNowPaneHidden(deps.root.dataset.nowPaneHidden !== "true");
    },
    setNowSize,
  };
}
