import type { HostResponse, PersonalNote } from "@fluent-frame/shared";
import { errorMessage, isExtensionContextInvalidated } from "./chromeRuntimeErrors.js";
import type { ContentScriptRuntime } from "./learningGenerationClient.js";
import type { PersonalNotesStore } from "./personalNotesController.js";

function runtimeErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  return isExtensionContextInvalidated(error)
    ? "Extension was reloaded. Refresh this YouTube tab."
    : message
      ? message
      : "Local helper failed";
}

function rejectRuntimeLastError(error: chrome.runtime.LastError | undefined, reject: (reason?: unknown) => void): boolean {
  if (!error) {
    return false;
  }
  reject(new Error(error.message ?? "Local helper failed"));
  return true;
}

function rejectHostFailure(response: HostResponse | undefined, reject: (reason?: unknown) => void): boolean {
  if (response?.ok) {
    return false;
  }
  reject(new Error(response?.message ?? "Local helper failed"));
  return true;
}

export function createNativePersonalNotesStore(runtime: ContentScriptRuntime): PersonalNotesStore {
  return {
    load() {
      return new Promise((resolve, reject) => {
        try {
          runtime.sendMessage({ type: "getPersonalNotes" }, (response: HostResponse | undefined) => {
            if (rejectRuntimeLastError(runtime.lastError, reject) || rejectHostFailure(response, reject)) {
              return;
            }
            const notes = response?.ok && response.type === "personalNotes" ? response.notes : [];
            resolve(notes);
          });
        } catch (error) {
          reject(new Error(runtimeErrorMessage(error)));
        }
      });
    },
    save(notes: PersonalNote[]) {
      return new Promise((resolve, reject) => {
        try {
          runtime.sendMessage({ type: "savePersonalNotes", notes }, (response: HostResponse | undefined) => {
            if (rejectRuntimeLastError(runtime.lastError, reject) || rejectHostFailure(response, reject)) {
              return;
            }
            resolve();
          });
        } catch (error) {
          reject(new Error(runtimeErrorMessage(error)));
        }
      });
    },
  };
}
