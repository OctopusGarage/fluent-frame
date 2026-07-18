<a id="readme-top"></a>

# FluentFrame

[![CI](https://github.com/OctopusGarage/fluent-frame/actions/workflows/ci.yml/badge.svg)](https://github.com/OctopusGarage/fluent-frame/actions/workflows/ci.yml)
[![Gitleaks](https://github.com/OctopusGarage/fluent-frame/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/OctopusGarage/fluent-frame/actions/workflows/gitleaks.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![platform: Chrome | macOS](https://img.shields.io/badge/platform-Chrome%20%7C%20macOS-000000?logo=googlechrome&logoColor=white)](#prerequisites)

<p align="center">
  FluentFrame is a local-first Chrome extension for learning English while watching YouTube. It downloads real English captions, asks a local Codex or Claude CLI to produce corrected bilingual learning subtitles and phrase explanations, then renders them directly inside the video experience.
  <br />
  <br />
  <a href="docs/local-chrome-install.md"><strong>Read the quick Chrome install guide</strong></a>
  <br />
  <br />
  <a href="#features">Features</a>
  ·
  <a href="#getting-started">Getting Started</a>
  ·
  <a href="#architecture">Architecture</a>
  ·
  <a href="docs/manual-verification.md">Manual Verification</a>
</p>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#architecture">Architecture</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#first-run">First Run</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#configuration">Configuration</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#manual-verification">Manual Verification</a></li>
    <li><a href="#contributing-and-security">Contributing And Security</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

## About The Project

FluentFrame turns YouTube videos into an English-learning workspace. It keeps the original caption timing as the source of truth, then adds corrected English, natural Chinese translation, phrase explanations, usage notes, a Now pane, History, and Personal Notes.

The system is local-first. The Chrome extension never calls a hosted LLM API directly. Caption download, local agent execution, cache, notes, and diagnostics run through a native host on your machine.

It has two main runtime paths:

- **Video learning mode** - the YouTube page overlay and side panel show bilingual subtitles, learning events, history, and saved notes.
- **Local setup mode** - development-mode installation scripts build the extension, register the native host, link the Chrome extension ID, and diagnose missing dependencies.

The goal is not to replace watching the video. It lets the video remain the main experience while adding enough bilingual context and phrase explanation to make each clip useful for English study.

Detailed operation and verification docs:

- [docs/architecture.md](docs/architecture.md)
- [docs/local-chrome-install.md](docs/local-chrome-install.md)
- [docs/local-development-installation.md](docs/local-development-installation.md)
- [docs/manual-verification.md](docs/manual-verification.md)

### Built With

- **Language / runtime** - [TypeScript](https://www.typescriptlang.org/) on [Node.js](https://nodejs.org) 24+
- **Browser surface** - Chrome extension Manifest V3, content script, service worker, popup
- **Local bridge** - Chrome Native Messaging host
- **Caption source** - `yt-dlp`
- **Agent backends** - Codex CLI or Claude CLI
- **Build & test** - Vite, Vitest, Playwright, gitleaks, pnpm workspaces

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Features

- **Real YouTube caption pipeline** - downloads available English captions with `yt-dlp`.
- **Timing-safe bilingual subtitles** - preserves original SRT timing while adding corrected English and Chinese text.
- **Learning event generation** - uses Codex or Claude to produce phrase explanations, usage notes, and difficulty labels.
- **Streaming long-video batching** - processes long caption files in bounded 20-cue local-agent batches and renders each completed batch while later batches continue.
- **Video-native overlay** - renders subtitles and the Now pane inside the YouTube video instead of a detached learning page.
- **History and Personal Notes** - keeps generated learning sentences and user-saved notes under `~/.fluent-frame`.
- **Development-mode install wizard** - avoids Chrome Web Store payment while making local setup guided and repeatable.
- **Native-host diagnostics** - popup and CLI health checks report extension linking, `yt-dlp`, selected agent, and local paths.
- **Local quality gates** - unit tests, browser extension E2E, live YouTube E2E, AI output validation, CI, and Gitleaks.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Architecture

```text
                              Chrome / YouTube
        ┌────────────────────────────────────────────────────────────┐
        │ YouTube watch page                                          │
        │ content script, video overlay, Now pane, History, Notes     │
        └──────────────────────────────┬─────────────────────────────┘
                                       │ chrome.runtime.sendMessage
                                       ▼
        ┌────────────────────────────────────────────────────────────┐
        │ Chrome extension                                            │
        │ popup, service worker, protocol normalization               │
        └──────────────────────────────┬─────────────────────────────┘
                                       │ chrome.runtime.connect / connectNative
                                       ▼
        ┌────────────────────────────────────────────────────────────┐
        │ Native Messaging boundary                                   │
        │ com.octopusgarage.fluent_frame                              │
        │ allowed_origins = chrome-extension://<extension-id>/         │
        └──────────────────────────────┬─────────────────────────────┘
                                       │ stdio JSON messages
                                       ▼
        ┌────────────────────────────────────────────────────────────┐
        │ FluentFrame native host                                     │
        │ request validation, health checks, cache, notes, processing │
        └───────────────┬──────────────────────┬─────────────────────┘
                        │                      │
                        ▼                      ▼
        ┌──────────────────────────┐   ┌─────────────────────────────┐
        │ caption downloader        │   │ local agent runner          │
        │ yt-dlp -> source SRT      │   │ codex exec / claude --print │
        └──────────────┬───────────┘   └──────────────┬──────────────┘
                       │                              │
                       └──────────────┬───────────────┘
                                      ▼
        ┌────────────────────────────────────────────────────────────┐
        │ result validation + timing merge                            │
        │ original SRT timing remains authoritative                   │
        └──────────────────────────────┬─────────────────────────────┘
                                       ▼
        ┌────────────────────────────────────────────────────────────┐
        │ ~/.fluent-frame                                             │
        │ config.json, cache, notes.json, native-host wrapper         │
        └────────────────────────────────────────────────────────────┘
```

**Key points:**

- **Chrome cannot run shell commands directly** - it can only start the registered native host when the manifest allows the exact extension ID.
- **Original captions own timing** - the agent can correct English, translate Chinese, and explain phrases, but source SRT timing is merged back into the final result.
- **Long videos are batched** - there is no fixed video-duration limit; the native host splits large SRT files into 20-cue batches so local agents receive bounded prompts and the first streamed result arrives sooner.
- **Streaming generation is idempotent per video** - repeated clicks while one video is generating reuse the active stream; YouTube navigation disconnects stale work before the next video starts.
- **Local agents are explicit** - Codex and Claude are invoked by the native host only for generation requests.
- **One shared protocol** - extension and native host both import `packages/shared` types so request and response drift is caught by TypeScript and tests.
- **Development-mode distribution** - `pnpm setup` and `pnpm link:chrome` provide a no-store install path while preserving Chrome's required manual `Load unpacked` step.

Local state is stored under `~/.fluent-frame` by default:

```text
~/.fluent-frame/
├── bin/native-host
├── config.json
├── cache/<videoId>/<language>/<workflowVersion>/result.json
└── notes.json
```

Browser-side generation timing estimates are stored in YouTube page localStorage:

```text
fluentFrame.generationHistory.v1
```

See [docs/architecture.md](docs/architecture.md) for the full architecture notes.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

- Node.js 24+
- pnpm 10+
- Google Chrome
- `yt-dlp` available on `PATH`, or an absolute path passed with `FF_YTDLP_PATH`
- Codex CLI or Claude CLI available on `PATH`, or absolute paths passed with `FF_CODEX_PATH` / `FF_CLAUDE_PATH`

Optional overrides:

- `FF_YTDLP_PATH=/absolute/path/to/yt-dlp`
- `FF_AGENT=codex` or `FF_AGENT=claude`
- `FF_CODEX_PATH=/absolute/path/to/codex`
- `FF_CLAUDE_PATH=/absolute/path/to/claude`
- `FF_CACHE_DIR=/absolute/path/to/cache`

### Installation

FluentFrame is intended to run as a Chrome development-mode extension. No Chrome Web Store payment is required.

```bash
pnpm local:install
```

`pnpm setup` is kept as an alias for the same guided installer.

The interactive wizard detects local tools, lets you choose Codex or Claude, builds the workspace, installs the native host, opens `chrome://extensions`, and guides you through loading `apps/extension/dist`.

After the first install, update the development-mode extension with:

```bash
pnpm local:update
```

This pulls the latest source with `git pull --ff-only`, installs dependencies with the lockfile, rebuilds the extension and native host, refreshes the native-host wrapper, runs diagnostics, and opens `chrome://extensions` so you can click Reload on FluentFrame.

Useful local install commands:

```bash
pnpm local:install
pnpm local:update
pnpm local:open
pnpm run doctor
pnpm ff:doctor
pnpm link:chrome <extension-id>
pnpm uninstall:local
```

See [docs/local-development-installation.md](docs/local-development-installation.md) for the full guided install flow.

### First Run

1. Run `pnpm local:install`.
2. In Chrome, open `chrome://extensions`.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select `apps/extension/dist`.
6. Copy the extension ID and run `pnpm link:chrome <extension-id>` if you did not paste it into the setup wizard.
7. Open a YouTube video with English captions.
8. Click `Generate learning subtitles`.

For later updates, run `pnpm local:update`, then click Reload for FluentFrame in `chrome://extensions`.

Run local diagnostics any time:

```bash
pnpm run doctor
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

### YouTube Learning

1. Open a YouTube video with English captions.
2. Click `Generate learning subtitles`.
3. Read the corrected English subtitle and Chinese translation in the video overlay.
4. Use the Now pane and History to review generated learning events.
5. Save useful sentences and phrase explanations to Personal Notes.

Results are cached by video and workflow version. The default cache location is:

```text
~/.fluent-frame/cache
```

### Native Host Health

The extension popup runs a native-host health check and shows whether FluentFrame can reach:

- the native host
- `yt-dlp`
- the selected Codex or Claude agent
- the linked Chrome extension origin

If the popup reports setup issues, run:

```bash
pnpm run doctor
pnpm link:chrome <extension-id>
```

### Manual Debug Install

The preferred path is `pnpm setup`. Manual native-host commands are kept for debugging:

```bash
pnpm --filter @fluent-frame/native-host build
FF_EXTENSION_ID=<copied-extension-id> pnpm --filter @fluent-frame/native-host install:native-host
```

Chrome does not reliably inherit your interactive shell `PATH` on macOS. During install, the native-host installer resolves `yt-dlp`, Codex, and Claude, then writes absolute paths into the wrapper that Chrome launches. If a tool is not found, rerun the installer with explicit paths:

```bash
FF_EXTENSION_ID=<copied-extension-id> \
FF_YTDLP_PATH=/absolute/path/to/yt-dlp \
FF_CODEX_PATH=/absolute/path/to/codex \
FF_CLAUDE_PATH=/absolute/path/to/claude \
pnpm --filter @fluent-frame/native-host install:native-host
```

The installer writes the Chrome manifest to:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Configuration

Local config is stored in:

```text
~/.fluent-frame/config.json
```

Example:

```json
{
  "agent": "codex",
  "ytDlpPath": "/opt/homebrew/bin/yt-dlp",
  "codexPath": "/opt/homebrew/bin/codex",
  "claudePath": "/opt/homebrew/bin/claude"
}
```

Environment variables override the config file:

```bash
FF_AGENT=claude FF_CLAUDE_PATH=/absolute/path/to/claude pnpm setup
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:local
```

Run the browser E2E test with a real Chrome extension context:

```bash
pnpm e2e
```

Run the live YouTube E2E test with the real native host:

```bash
pnpm e2e:live
```

This opens a real YouTube watch page, downloads real captions with `yt-dlp`, runs the configured local agent through the native host, and verifies that generated subtitles and phrase explanations render in the extension. It defaults to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`; override with `FF_LIVE_YOUTUBE_URL=<url>`.

Run the local subtitle-quality eval:

```bash
pnpm eval:ai
```

The AI eval sends a small SRT sample to the same prompt used by the native host, then validates that the local agent returns strict JSON with preserved cue IDs/timing, corrected English, natural Chinese text, phrase references, explanations, and valid difficulty labels.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Manual Verification

Use [docs/manual-verification.md](docs/manual-verification.md) for the full local QA checklist, including missing dependency checks, same-tab YouTube navigation, overlay toggling, cache behavior, and native-host wrapper verification.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing And Security

- [CONTRIBUTING.md](CONTRIBUTING.md) describes the local quality gate and project conventions.
- [SECURITY.md](SECURITY.md) documents the native-host trust boundary and vulnerability reporting path.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

MIT. See [LICENSE](LICENSE).

<p align="right">(<a href="#readme-top">back to top</a>)</p>
