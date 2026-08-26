import { describe, expect, it } from "vitest";
import { compactHomePath } from "../src/displayPath.js";

describe("compactHomePath", () => {
  it("renders macOS home paths with a tilde for display", () => {
    expect(compactHomePath("/Users/kingsonwu/.nvm/versions/node/v24.13.1/bin/codex")).toBe(
      "~/.nvm/versions/node/v24.13.1/bin/codex",
    );
  });

  it("renders Linux home paths with a tilde for display", () => {
    expect(compactHomePath("/home/kingsonwu/.local/bin/claude")).toBe("~/.local/bin/claude");
  });

  it("leaves non-home paths unchanged", () => {
    expect(compactHomePath("/opt/homebrew/bin/yt-dlp")).toBe("/opt/homebrew/bin/yt-dlp");
  });
});
