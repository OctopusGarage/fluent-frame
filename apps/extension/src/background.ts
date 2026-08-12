import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import {
  createEnqueueVideoRequest,
  createGetPersonalNotesRequest,
  createGetQueueRequest,
  createHealthCheckRequest,
  createProcessVideoRequest,
  createRemoveQueueJobRequest,
  createRetryQueueJobRequest,
  createSavePersonalNotesRequest,
  extractYoutubeVideoIdFromUrl,
} from "./backgroundRequests.js";
import {
  createErrorResponse,
  createRequestId,
  normalizeExtensionError,
  normalizeNativeResponse,
  sendNativeRequest,
  streamNativeRequest,
  type ExtensionError,
  type RuntimePort,
} from "./nativeHostClient.js";

export type ExtensionRuntime = {
  lastError: chrome.runtime.LastError | undefined;
  connectNative?(hostName: string): RuntimePort;
  sendNativeMessage(hostName: string, request: HostRequest, callback: (response: unknown) => void): void;
  onMessage: {
    addListener(
      callback: (message: unknown, sender: unknown, sendResponse: (response: HostResponse) => void) => boolean,
    ): void;
  };
  onConnect?: {
    addListener(callback: (port: RuntimePort) => void): void;
  };
};

type ContextMenusApi = {
  removeAll(callback?: () => void): void;
  create(properties: chrome.contextMenus.CreateProperties, callback?: () => void): void;
  onClicked: {
    addListener(callback: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
  };
};

type ExtensionChromeApi = {
  runtime: ExtensionRuntime & {
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

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function registerStreamingPortListener(runtime: ExtensionRuntime): void {
  runtime.onConnect?.addListener((contentPort) => {
    if (contentPort.name !== "fluent-frame-process-video") {
      return;
    }
    let nativeStream: { disconnect(): void } | undefined;

    contentPort.onMessage.addListener((message: unknown) => {
      if (!isObject(message) || message.type !== "processCurrentVideoStream") {
        return;
      }
      let request: HostRequest;
      try {
        request = createProcessVideoRequest(message.videoId, true);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        contentPort.postMessage(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return;
      }
      nativeStream = streamNativeRequest(runtime, request, {
        onMessage(response) {
          contentPort.postMessage(response);
        },
        onDisconnectBeforeTerminal(requestId) {
          contentPort.postMessage(createErrorResponse(requestId, "NATIVE_HOST_DISCONNECTED", "Native host disconnected"));
        },
      });
    });

    contentPort.onDisconnect.addListener(() => {
      nativeStream?.disconnect();
      nativeStream = undefined;
    });
  });
}

export { createProcessVideoRequest } from "./backgroundRequests.js";
export { createRequestId, normalizeExtensionError, normalizeNativeResponse };

function forwardNativeRequest(
  runtime: ExtensionRuntime,
  request: HostRequest,
  sendResponse: (response: HostResponse) => void,
): true {
  sendNativeRequest(runtime, request).then(sendResponse, (error) => {
    const extensionError = normalizeExtensionError(error);
    sendResponse(createErrorResponse(request.id, extensionError.code, extensionError.message));
  });
  return true;
}

function enqueueContextMenuVideo(
  runtime: ExtensionRuntime,
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

function rememberContextMenuLink(sender: unknown, message: Record<string, unknown>): void {
  const tabId = (sender as { tab?: { id?: unknown } }).tab?.id;
  if (typeof tabId !== "number") {
    return;
  }
  const url = typeof message.url === "string" && message.url.trim() ? message.url.trim() : undefined;
  if (!extractYoutubeVideoIdFromUrl(url)) {
    return;
  }
  if (!url) {
    return;
  }
  const title = typeof message.title === "string" && message.title.trim() ? message.title.trim() : undefined;
  rememberedContextLinks.set(tabId, {
    url,
    ...(title ? { title } : {}),
    rememberedAt: Date.now(),
  });
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

export function registerQueueContextMenus(chromeApi: ExtensionChromeApi): void {
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

export function registerBackgroundListener(runtime: ExtensionRuntime): void {
  registerStreamingPortListener(runtime);
  runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isObject(message) && message.type === "rememberContextMenuLink") {
      rememberContextMenuLink(sender, message);
      sendResponse({ id: createRequestId(), ok: true, type: "cacheMiss" });
      return false;
    }

    if (isObject(message) && message.type === "getQueue") {
      return forwardNativeRequest(runtime, createGetQueueRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "enqueueVideo") {
      let request: HostRequest;
      try {
        request = createEnqueueVideoRequest({
          videoId: message.videoId,
          url: message.url,
          title: message.title,
        });
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }
      return forwardNativeRequest(runtime, request, sendResponse);
    }

    if (isObject(message) && message.type === "removeQueueJob") {
      let request: HostRequest;
      try {
        request = createRemoveQueueJobRequest(message.jobId);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }
      return forwardNativeRequest(runtime, request, sendResponse);
    }

    if (isObject(message) && message.type === "retryQueueJob") {
      let request: HostRequest;
      try {
        request = createRetryQueueJobRequest(message.jobId);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }
      return forwardNativeRequest(runtime, request, sendResponse);
    }

    if (isObject(message) && message.type === "healthCheck") {
      return forwardNativeRequest(runtime, createHealthCheckRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "getPersonalNotes") {
      return forwardNativeRequest(runtime, createGetPersonalNotesRequest(), sendResponse);
    }

    if (isObject(message) && message.type === "savePersonalNotes") {
      let request: HostRequest;
      try {
        request = createSavePersonalNotesRequest(message.notes);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }
      return forwardNativeRequest(runtime, request, sendResponse);
    }

    if (isObject(message) && message.type === "processCurrentVideo") {
      let request: HostRequest;
      try {
        request = createProcessVideoRequest(message.videoId);
      } catch (error) {
        const extensionError = normalizeExtensionError(error);
        sendResponse(createErrorResponse(createRequestId(), extensionError.code, extensionError.message));
        return false;
      }

      return forwardNativeRequest(runtime, request, sendResponse);
    }
    return false;
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerBackgroundListener(chrome.runtime);
  registerQueueContextMenus(chrome as ExtensionChromeApi);
}
