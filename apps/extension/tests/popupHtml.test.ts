import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("popup.html", () => {
  it("constrains the popup viewport instead of painting an empty wide canvas", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../src/popup.html"), "utf8");
    document.open();
    document.write(source);
    document.close();
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const bodyStyle = window.getComputedStyle(document.body);

    expect(htmlStyle.width).toBe("372px");
    expect(htmlStyle.overflowX).toBe("hidden");
    expect(bodyStyle.width).toBe("372px");
    expect(bodyStyle.boxSizing).toBe("border-box");
    expect(bodyStyle.overflowX).toBe("hidden");
  });
});
