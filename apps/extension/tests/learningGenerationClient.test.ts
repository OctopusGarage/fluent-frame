import { describe, expect, it, vi } from "vitest";
import { createRuntimeLearningGenerationClient, type ContentScriptRuntime } from "../src/learningGenerationClient.js";

function handlers() {
  return {
    onProgress: vi.fn(),
    onPartialResult: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn(),
    onDisconnect: vi.fn(),
  };
}

describe("createRuntimeLearningGenerationClient", () => {
  it("surfaces synchronous streaming connection failures", () => {
    const runtime = {
      lastError: undefined,
      connect: vi.fn(() => {
        throw new Error("Extension context invalidated");
      }),
      sendMessage: vi.fn(),
    } satisfies ContentScriptRuntime;
    const nextHandlers = handlers();
    const client = createRuntimeLearningGenerationClient(runtime);

    const active = client.start("dQw4w9WgXcQ", nextHandlers);

    expect(active.disconnect).toEqual(expect.any(Function));
    expect(nextHandlers.onError).toHaveBeenCalledWith("Extension was reloaded. Refresh this YouTube tab.");
  });
});
