<a id="readme-top"></a>

# FluentFrame

[![CI](https://github.com/OctopusGarage/fluent-frame/actions/workflows/ci.yml/badge.svg)](https://github.com/OctopusGarage/fluent-frame/actions/workflows/ci.yml)
[![Gitleaks](https://github.com/OctopusGarage/fluent-frame/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/OctopusGarage/fluent-frame/actions/workflows/gitleaks.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![platform: Chrome | macOS](https://img.shields.io/badge/platform-Chrome%20%7C%20macOS-000000?logo=googlechrome&logoColor=white)](#requirements)

FluentFrame is a local-first Chrome extension for learning English while watching YouTube. It downloads available English captions, asks the local Codex CLI to produce corrected English subtitles, Chinese translations, and phrase explanations, then shows the result in a YouTube overlay and side panel.

No hosted LLM API key is required. Processing runs through local command-line tools on your machine.

## Architecture

```text
YouTube page
  -> Chrome content script
  -> Chrome extension service worker
  -> Chrome native messaging host
  -> yt-dlp downloads captions
  -> local agent CLI generates learning JSON
  -> validated cache in ~/.fluent-frame
  -> video overlay, Now pane, History, Personal Notes
```

The extension cannot run shell commands directly. Chrome only starts the native host registered as `com.octopusgarage.fluent_frame` when the host manifest allows the exact extension ID.

Detailed architecture and local verification docs:

- [docs/architecture.md](docs/architecture.md)
- [docs/manual-verification.md](docs/manual-verification.md)

## Requirements

- Node.js 24+
- pnpm 10+
- Google Chrome
- `yt-dlp` available on `PATH`, or an absolute path passed with `FF_YTDLP_PATH`
- Codex CLI available on `PATH`, or an absolute path passed with `FF_CODEX_PATH`

Optional overrides:

- `FF_YTDLP_PATH=/absolute/path/to/yt-dlp`
- `FF_CODEX_PATH=/absolute/path/to/codex`
- `FF_CACHE_DIR=/absolute/path/to/cache`

## Build

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm verify:local
```

## End-To-End And AI Eval

Run the browser e2e test with a real Chrome extension context:

```bash
pnpm e2e
```

The Playwright test loads `apps/extension/dist` into Google Chrome, routes a deterministic YouTube fixture page, verifies content-script injection across YouTube SPA-style navigation, opens the extension popup, and checks the native-host error path.

Run the live YouTube e2e test with the real native host:

```bash
pnpm e2e:live
```

This opens a real YouTube watch page, downloads real captions with `yt-dlp`, runs local Codex through the native host, and verifies that generated subtitles and phrase explanations render in the extension. It defaults to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`; override with `FF_LIVE_YOUTUBE_URL=<url>`.

Run the local Codex subtitle-quality eval:

```bash
pnpm eval:ai
```

The AI eval sends a small SRT sample to the same prompt used by the native host, then validates that Codex returns strict JSON with preserved cue IDs/timing, corrected English, natural Chinese text, phrase references, explanations, and valid difficulty labels.

## Load The Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select `apps/extension/dist`.
5. Copy the extension ID shown by Chrome.

## Install The Native Host

Build the native host first:

```bash
pnpm --filter @fluent-frame/native-host build
```

Install the Chrome native messaging manifest with the extension ID copied from Chrome:

```bash
FF_EXTENSION_ID=<copied-extension-id> pnpm --filter @fluent-frame/native-host install:native-host
```

Chrome does not reliably inherit your interactive shell `PATH` on macOS. During install, the native-host installer resolves `yt-dlp` and `codex` and writes absolute paths into the wrapper that Chrome launches. If either tool is not found, rerun the installer with explicit paths:

```bash
FF_EXTENSION_ID=<copied-extension-id> \
FF_YTDLP_PATH=/absolute/path/to/yt-dlp \
FF_CODEX_PATH=/absolute/path/to/codex \
pnpm --filter @fluent-frame/native-host install:native-host
```

The installer writes the Chrome manifest to:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json
```

If you installed before copying the extension ID, rerun the installer with `FF_EXTENSION_ID`. A placeholder origin cannot connect to Chrome.

## Use

1. Open a YouTube video with English captions.
2. Click `Generate learning subtitles`.
3. Read the corrected English subtitle and Chinese translation in the video overlay.
4. Open the side panel for phrase explanations.

Results are cached by video and workflow version. The default cache location is:

```text
~/.fluent-frame/cache
```

## Manual Verification

Use [docs/manual-verification.md](docs/manual-verification.md) for the full local QA checklist, including missing dependency checks, same-tab YouTube navigation, overlay toggling, and cache behavior.

## Contributing And Security

- [CONTRIBUTING.md](CONTRIBUTING.md) describes the local quality gate and project conventions.
- [SECURITY.md](SECURITY.md) documents the native-host trust boundary and vulnerability reporting path.

<p align="right">(<a href="#readme-top">back to top</a>)</p>
