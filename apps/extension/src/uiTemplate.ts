export function createCoachRoot(doc: Document): HTMLElement {
  const root = doc.createElement("section");
  root.id = "ff-root";
  root.dataset.overlayHidden = "false";
  root.dataset.layout = "panel";
  root.dataset.panelCollapsed = "false";
  root.dataset.hasResult = "false";
  root.dataset.nowPaneHidden = "false";
  root.dataset.nowSize = "medium";
  root.innerHTML = `
    <button id="ff-video-badge" type="button" aria-label="Open FluentFrame" title="FluentFrame">
      <span class="ff-badge-glyph" aria-hidden="true">
        <span class="ff-badge-spark"></span>
        <span class="ff-badge-letter">A</span>
      </span>
    </button>
    <div id="ff-overlay" aria-live="polite">
      <div class="ff-caption-card" aria-label="Drag learning subtitles">
        <div id="ff-english"></div>
        <div id="ff-chinese"></div>
      </div>
    </div>
    <aside id="ff-video-now" aria-label="Current learning events in video" data-now-size="medium" hidden></aside>
    <aside id="ff-panel" aria-label="FluentFrame">
      <div class="ff-header">
        <div class="ff-drag-handle" aria-label="Drag panel">
          <span aria-hidden="true"></span>
        </div>
        <div class="ff-brand">
          <span class="ff-brand-mark" aria-hidden="true">A</span>
          <div>
            <div class="ff-title">FluentFrame</div>
            <div class="ff-subtitle">Bilingual captions and learning notes</div>
          </div>
        </div>
        <div id="ff-status">Ready</div>
      </div>

      <button id="ff-generate" class="ff-command ff-primary" type="button" aria-label="Generate learning subtitles">
        <span class="ff-command-icon" aria-hidden="true">AI</span>
        <span>
          <span class="ff-command-title">Generate subtitles</span>
          <span class="ff-command-meta">Translate and explain this video</span>
        </span>
      </button>
      <button id="ff-enqueue" class="ff-command" type="button" aria-label="Add current video to FluentFrame queue">
        <span class="ff-command-icon" aria-hidden="true">Q</span>
        <span>
          <span class="ff-command-title">Add to queue</span>
          <span class="ff-command-meta">Generate before watching later</span>
        </span>
      </button>
      <div id="ff-progress" aria-live="polite" hidden></div>

      <div class="ff-control-row">
        <button id="ff-toggle-overlay" class="ff-quiet-button" type="button" aria-pressed="false">
          <span aria-hidden="true">CC</span>
          <span class="ff-command-title">Subtitles</span>
          <span class="ff-command-meta">Visible</span>
        </button>

        <button id="ff-toggle-now" class="ff-quiet-button" type="button" aria-pressed="false">
          <span aria-hidden="true">N</span>
          <span class="ff-command-title">Now pane</span>
          <span class="ff-command-meta">Visible</span>
        </button>

        <div class="ff-layout-switch" aria-label="Display style">
          <button type="button" data-layout-option="panel" aria-pressed="true">Panel</button>
          <button type="button" data-layout-option="toolbar" aria-pressed="false">Bar</button>
          <button type="button" data-layout-option="drawer" aria-pressed="false">Study</button>
        </div>

        <div class="ff-layout-switch" aria-label="Now pane text size">
          <button type="button" data-now-size="small" aria-pressed="false">Small</button>
          <button type="button" data-now-size="medium" aria-pressed="true">Medium</button>
          <button type="button" data-now-size="large" aria-pressed="false">Large</button>
        </div>
      </div>

      <div class="ff-section-label" data-section-label="now">Now</div>
      <div id="ff-current-phrase" aria-live="polite"></div>
      <div class="ff-section-label" data-section-label="history">History</div>
      <div id="ff-phrase-list"></div>
      <div class="ff-section-label" data-section-label="notes">Personal Notes</div>
      <div id="ff-notes-list" aria-live="polite"></div>
    </aside>
  `;
  return root;
}

export function compactProgressMessage(message?: string): string | undefined {
  if (message?.startsWith("Generating learning subtitles... ETA about ")) {
    return message.replace("Generating learning subtitles... ", "");
  }
  if (message === "Generating learning subtitles... ETA after first run") {
    return "ETA after first successful run";
  }
  if (message?.startsWith("Learning subtitles ready in ")) {
    return message.replace("Learning subtitles ready in ", "Ready in ");
  }
  return undefined;
}
