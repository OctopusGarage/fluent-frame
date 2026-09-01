import { describe, expect, it } from "vitest";
import { errorMessage, isExtensionContextInvalidated } from "../src/chromeRuntimeErrors.js";

describe("chromeRuntimeErrors", () => {
  it("recognizes extension reload errors", () => {
    expect(isExtensionContextInvalidated(new Error("Extension context invalidated."))).toBe(true);
    expect(isExtensionContextInvalidated(new Error("Other failure"))).toBe(false);
  });

  it("returns concrete Error messages only", () => {
    expect(errorMessage(new Error("Local helper failed"))).toBe("Local helper failed");
    expect(errorMessage("Local helper failed")).toBeUndefined();
  });
});
