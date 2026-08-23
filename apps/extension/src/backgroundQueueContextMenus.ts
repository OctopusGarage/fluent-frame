import type { HostResponse } from "@fluent-frame/shared";
import { createEnqueueVideoRequest } from "./backgroundRequests.js";
import { sendNativeRequest, type NativeClientRuntime } from "./nativeHostClient.js";
import { createRequestId } from "./requestId.js";
import { extractYoutubeVideoIdFromUrl } from "./youtubeUrl.js";

type ContextMenusApi = {
  removeAll(callback?: () => void): void;
  create(properties: chrome.contextMenus.CreateProperties, callback?: () => void): void;
  onClicked: {
    addListener(callback: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
  };
};

export type QueueContextMenuChromeApi = {
  runtime: NativeClientRuntime & {
    onInstalled?: { addListener(callback: () => void): void };
    onStartup?: { addListener(callback: () => void): void };
  };
  contextMenus?: ContextMenusApi;
};

const ENQUEUE_LINK_CONTEXT_MENU_ID = "fluent-frame-enqueue-link-video";
const ENQUEUE_PAGE_CONTEXT_MENU_ID = "fluent-frame-enqueue-page-video";
const ENQUEUE_CONTEXT_MENU_IDS = new Set([ENQUEUE_LINK_CONTEXT_MENU_ID, ENQUEUE_PAGE_CONTEXT_MENU_ID]);
const CONTEXT_LINK_TTL_MS = 30_000;

type RememberedContextLink = {
  url: string;
  title?: string;
  rememberedAt: number;
};

const rememberedContextLinks = new Map<number, RememberedContextLink>();

function enqueueContextMenuVideo(
  runtime: NativeClientRuntime,
  input: { url?: string; title?: string },
): void {
  const videoId = extractYoutubeVideoIdFromUrl(input.url);
  if (!videoId) {
    return;
  }
  const request = createEnqueueVideoRequest({ videoId, url: input.url, title: input.title });
  sendNativeRequest(runtime, request).catch(() => {
    // Context menu actions have no visible response surface; popup queue state remains the source of truth.
  });
}

export function rememberQueueContextMenuLink(sender: unknown, message: Record<string, unknown>): HostResponse {
  const tabId = (sender as { tab?: { id?: unknown } }).tab?.id;
  if (typeof tabId !== "number") {
    return { id: createRequestId(), ok: true, type: "cacheMiss" };
  }
  const url = typeof message.url === "string" && message.url.trim() ? message.url.trim() : undefined;
  if (!url) {
    return { id: createRequestId(), ok: true, type: "cacheMiss" };
  }
  if (!extractYoutubeVideoIdFromUrl(url)) {
    return { id: createRequestId(), ok: true, type: "cacheMiss" };
  }
  const title = typeof message.title === "string" && message.title.trim() ? message.title.trim() : undefined;
  rememberedContextLinks.set(tabId, {
    url,
    ...(title ? { title } : {}),
    rememberedAt: Date.now(),
  });
  return { id: createRequestId(), ok: true, type: "cacheMiss" };
}

function rememberedLinkForTab(tabId: number | undefined): RememberedContextLink | undefined {
  if (typeof tabId !== "number") {
    return undefined;
  }
  const remembered = rememberedContextLinks.get(tabId);
  if (!remembered) {
    return undefined;
  }
  if (Date.now() - remembered.rememberedAt > CONTEXT_LINK_TTL_MS) {
    rememberedContextLinks.delete(tabId);
    return undefined;
  }
  return remembered;
}

function sameYoutubeVideo(left: string | undefined, right: string | undefined): boolean {
  const leftVideoId = extractYoutubeVideoIdFromUrl(left);
  const rightVideoId = extractYoutubeVideoIdFromUrl(right);
  return !!leftVideoId && leftVideoId === rightVideoId;
}

export function registerQueueContextMenus(chromeApi: QueueContextMenuChromeApi): void {
  const maybeMenus = chromeApi.contextMenus;
  if (!maybeMenus) {
    return;
  }
  const menus: ContextMenusApi = maybeMenus;

  function createMenus(): void {
    menus.removeAll(() => {
      menus.create({
        id: ENQUEUE_LINK_CONTEXT_MENU_ID,
        title: "Add video to FluentFrame queue",
        contexts: ["link"],
        documentUrlPatterns: ["https://www.youtube.com/*"],
        targetUrlPatterns: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*", "https://youtu.be/*"],
      });
      menus.create({
        id: ENQUEUE_PAGE_CONTEXT_MENU_ID,
        title: "Add current video to FluentFrame queue",
        contexts: ["page", "video"],
        documentUrlPatterns: ["https://www.youtube.com/watch*", "https://www.youtube.com/shorts/*"],
      });
    });
  }

  createMenus();
  chromeApi.runtime.onInstalled?.addListener(createMenus);
  chromeApi.runtime.onStartup?.addListener(createMenus);
  menus.onClicked.addListener((info, tab) => {
    const menuItemId = String(info.menuItemId);
    if (!ENQUEUE_CONTEXT_MENU_IDS.has(menuItemId)) {
      return;
    }
    const remembered = rememberedLinkForTab(tab?.id);
    const url = menuItemId === ENQUEUE_LINK_CONTEXT_MENU_ID ? info.linkUrl ?? remembered?.url : info.pageUrl ?? tab?.url;
    const title = menuItemId === ENQUEUE_LINK_CONTEXT_MENU_ID && remembered && sameYoutubeVideo(remembered.url, url)
      ? remembered.title
      : tab?.title;
    enqueueContextMenuVideo(chromeApi.runtime, { ...(url ? { url } : {}), ...(title ? { title } : {}) });
  });
}
