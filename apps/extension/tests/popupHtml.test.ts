import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("popup.html", () => {
  it("lets popup content fill Chrome's popup viewport instead of leaving a blank right side", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../src/popup.html"), "utf8");
    document.open();
    document.write(source);
    document.close();
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const bodyStyle = window.getComputedStyle(document.body);

    expect(htmlStyle.width).toBe("100vw");
    expect(htmlStyle.overflowX).toBe("hidden");
    expect(bodyStyle.width).toBe("100vw");
    expect(bodyStyle.minWidth).toBe("372px");
    expect(bodyStyle.maxWidth).toBe("800px");
    expect(bodyStyle.boxSizing).toBe("border-box");
    expect(bodyStyle.overflowX).toBe("hidden");
  });
});
