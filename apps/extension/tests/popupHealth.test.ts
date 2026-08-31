import { describe, expect, it, vi } from "vitest";
import { createPopupHealth } from "../src/popupHealth.js";

function renderHealthDom(): void {
  document.body.innerHTML = `
    <div id="native-host"></div>
    <div id="yt-dlp"></div>
    <div id="agent"></div>
    <div id="status"></div>
  `;
}

describe("createPopupHealth", () => {
  it("renders healthy native host checks", async () => {
    renderHealthDom();
    const setStatus = vi.fn();
    const sendMessage = vi.fn(async () => ({
      ok: true,
      type: "health",
      health: {
        agent: "codex",
        workflowVersion: "2026-07-21",
        ytDlpPath: "/Users/example/bin/yt-dlp",
        codexPath: "/Users/example/bin/codex",
        checks: {
          ytDlp: true,
          codex: true,
          claude: false,
        },
      },
    }));

    await createPopupHealth({ doc: document, runtime: { sendMessage }, setStatus }).refresh();

    expect(sendMessage).toHaveBeenCalledWith({ type: "healthCheck" });
    expect(document.getElementById("native-host")?.textContent).toBe("OK - Native host: 2026-07-21");
    expect(document.getElementById("native-host")?.dataset.state).toBe("ok");
    expect(document.getElementById("yt-dlp")?.textContent).toBe("OK - yt-dlp: ~/bin/yt-dlp");
    expect(document.getElementById("agent")?.textContent).toBe("OK - Codex agent: ~/bin/codex");
    expect(setStatus).toHaveBeenCalledWith("FluentFrame is ready.");
  });

  it("renders setup guidance for unavailable native host responses", async () => {
    renderHealthDom();
    const setStatus = vi.fn();
    const sendMessage = vi.fn(async () => ({
      ok: false,
      type: "error",
      code: "NATIVE_HOST_UNAVAILABLE",
      message: "not connected",
    }));

    await createPopupHealth({ doc: document, runtime: { sendMessage }, setStatus }).refresh();

    expect(document.getElementById("native-host")?.textContent).toBe("Needs setup - Native host: not connected");
    expect(document.getElementById("yt-dlp")?.dataset.state).toBe("missing");
    expect(document.getElementById("agent")?.textContent).toBe("Needs setup - Agent: run pnpm setup");
    expect(setStatus).toHaveBeenCalledWith("Run pnpm setup, then pnpm link:chrome <extension-id>.");
  });

  it("renders setup guidance when the health request rejects", async () => {
    renderHealthDom();
    const setStatus = vi.fn();
    const sendMessage = vi.fn(async () => {
      throw new Error("native messaging disconnected");
    });

    await createPopupHealth({ doc: document, runtime: { sendMessage }, setStatus }).refresh();

    expect(document.getElementById("native-host")?.textContent).toBe("Needs setup - Native host: not connected");
    expect(document.getElementById("agent")?.textContent).toBe("Needs setup - Agent");
    expect(setStatus).toHaveBeenCalledWith("Run pnpm setup, then pnpm link:chrome <extension-id>.");
  });
});
