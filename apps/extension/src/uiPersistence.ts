export type LayoutMode = "panel" | "toolbar" | "drawer";
export type NowPaneSize = "small" | "medium" | "large";

export type ElementPosition = {
  left?: string;
  top?: string;
  right?: string;
  bottom?: string;
  transform?: string;
};

export type PersistedUiState = {
  layout?: LayoutMode;
  panelCollapsed?: boolean;
  overlayHidden?: boolean;
  nowPaneHidden?: boolean;
  nowSize?: NowPaneSize;
  panelDragged?: boolean;
  subtitleDragged?: boolean;
  videoNowDragged?: boolean;
  panelPosition?: ElementPosition;
  overlayPosition?: ElementPosition;
  videoNowPosition?: ElementPosition;
};

const UI_STATE_STORAGE_KEY = "fluentFrame.uiState.v1";

export function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "panel" || value === "toolbar" || value === "drawer";
}

export function isNowPaneSize(value: unknown): value is NowPaneSize {
  return value === "small" || value === "medium" || value === "large";
}

export function readUiState(win: Window | null): PersistedUiState {
  try {
    const raw = win?.localStorage?.getItem(UI_STATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    return parsed && typeof parsed === "object" ? parsed as PersistedUiState : {};
  } catch {
    return {};
  }
}

export function writeUiState(win: Window | null, state: PersistedUiState): void {
  try {
    win?.localStorage?.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; UI controls should still work for the current page.
  }
}

export function clearUiState(win: Window | null): void {
  try {
    win?.localStorage?.removeItem(UI_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the current page state can still be reset.
  }
}
