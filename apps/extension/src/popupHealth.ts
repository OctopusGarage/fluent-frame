import { compactHomePath } from "./displayPath.js";

type PopupHealthResponse =
  | {
      ok: true;
      type: "health";
      health: {
        agent: "codex" | "claude";
        workflowVersion: string;
        ytDlpPath: string;
        codexPath?: string;
        claudePath?: string;
        checks: {
          ytDlp: boolean;
          codex: boolean;
          claude: boolean;
        };
      };
    }
  | {
      ok: false;
      type: "error";
      code: string;
      message: string;
    };

export type PopupHealthRuntime = {
  sendMessage(message: unknown): Promise<unknown>;
};

export type PopupHealthDeps = {
  doc: Document;
  runtime: PopupHealthRuntime;
  setStatus(message: string): void;
};

export function createPopupHealth(deps: PopupHealthDeps) {
  function setHealthLine(id: string, label: string, healthy: boolean, detail: string): void {
    const target = deps.doc.getElementById(id);
    if (!target) {
      return;
    }
    const displayDetail = compactHomePath(detail);
    target.textContent = `${healthy ? "OK" : "Needs setup"} - ${label}${displayDetail ? `: ${displayDetail}` : ""}`;
    target.dataset.state = healthy ? "ok" : "missing";
  }

  async function refresh(): Promise<void> {
    try {
      const response = (await deps.runtime.sendMessage({ type: "healthCheck" })) as PopupHealthResponse;
      if (!response?.ok || response.type !== "health") {
        setHealthLine("native-host", "Native host", false, response?.message ?? "not connected");
        setHealthLine("yt-dlp", "yt-dlp", false, "");
        setHealthLine("agent", "Agent", false, "run pnpm setup");
        deps.setStatus("Run pnpm setup, then pnpm link:chrome <extension-id>.");
        return;
      }

      const health = response.health;
      const agentAvailable = health.agent === "claude" ? health.checks.claude : health.checks.codex;
      setHealthLine("native-host", "Native host", true, health.workflowVersion);
      setHealthLine("yt-dlp", "yt-dlp", health.checks.ytDlp, health.ytDlpPath);
      setHealthLine(
        "agent",
        `${health.agent === "claude" ? "Claude" : "Codex"} agent`,
        agentAvailable,
        health.agent === "claude" ? (health.claudePath ?? "") : (health.codexPath ?? ""),
      );
      deps.setStatus(
        agentAvailable && health.checks.ytDlp ? "FluentFrame is ready." : "Run pnpm run doctor for local setup fixes.",
      );
    } catch {
      setHealthLine("native-host", "Native host", false, "not connected");
      setHealthLine("yt-dlp", "yt-dlp", false, "");
      setHealthLine("agent", "Agent", false, "");
      deps.setStatus("Run pnpm setup, then pnpm link:chrome <extension-id>.");
    }
  }

  return {
    refresh,
  };
}
