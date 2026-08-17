import {
  registerQueueContextMenus,
  type QueueContextMenuChromeApi,
} from "./backgroundQueueContextMenus.js";
import { registerNativeMessageListener, type NativeMessageRuntime } from "./backgroundNativeMessages.js";
import { registerStreamingPortListener, type StreamingRuntime } from "./backgroundStreaming.js";

export type ExtensionRuntime = NativeMessageRuntime & StreamingRuntime;

type ExtensionChromeApi = {
  runtime: ExtensionRuntime & {
    onInstalled?: { addListener(callback: () => void): void };
    onStartup?: { addListener(callback: () => void): void };
  };
} & QueueContextMenuChromeApi;

export function registerBackgroundListener(runtime: ExtensionRuntime): void {
  registerStreamingPortListener(runtime);
  registerNativeMessageListener(runtime);
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerBackgroundListener(chrome.runtime);
  registerQueueContextMenus(chrome as ExtensionChromeApi);
}
