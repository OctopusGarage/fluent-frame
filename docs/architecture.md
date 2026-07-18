# Architecture

FluentFrame is split into three layers:

```text
apps/extension      Chrome extension UI, service worker, and YouTube page integration
apps/native-host    local Node process launched by Chrome Native Messaging
packages/shared     protocol types and validators used by both sides
```

## Trust Boundary

Chrome extension JavaScript cannot run local commands. FluentFrame uses Chrome
Native Messaging. One-shot health, notes, and fallback requests use:

```text
chrome.runtime.sendNativeMessage("com.octopusgarage.fluent_frame", request)
```

Streaming generation opens a long-lived port instead:

```text
chrome.runtime.connect({ name: "fluent-frame-process-video" })
chrome.runtime.connectNative("com.octopusgarage.fluent_frame")
```

Chrome resolves `com.octopusgarage.fluent_frame` through:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json
```

The manifest must contain:

- the same native host name
- an executable path
- `allowed_origins` with the exact Chrome extension ID

Only then does Chrome start `~/.fluent-frame/bin/native-host` and exchange JSON
messages over stdin/stdout.

## Processing Flow

```text
Generate subtitles click
  -> content script extracts YouTube video ID
  -> background service worker creates processVideo request
  -> native host validates request
  -> cache lookup by video/language/workflow
  -> yt-dlp downloads English captions as SRT
  -> configured Codex or Claude CLI returns subtitle + phrase JSON
  -> result validator enforces schema and references
  -> source SRT timing is merged back into agent output
  -> result is cached and returned to Chrome
```

The original SRT remains the timing authority. Agent output may correct English,
add Chinese text, and create learning events, but it must not redefine playback
timing.

## Persistent Data

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

## Long Videos

FluentFrame does not enforce a fixed video-duration limit. The limiting unit is
caption size. The native host splits long SRT files into 20-cue batches before
calling Codex or Claude, then merges the batch outputs back into one
`LearningSubtitleResult`. Original SRT cue IDs and timing remain authoritative.

Generation uses a long-lived Chrome port for the active video. Each completed
agent batch is emitted as a `partialResult`, so the browser can render early
learning subtitles while later batches are still generating. A normal native-host
exit after the final `result` is treated as completion, while YouTube navigation
disconnects the active port so stale batches cannot overwrite the new video.

## Main Protocol Types

`packages/shared` defines:

- `HostRequest`
- `HostResponse`
- `HostHealth`
- `LearningSubtitleResult`
- `SubtitleCue`
- `PhraseExplanation`
- `PersonalNote`

Both extension and native host import these types so protocol drift is caught by
TypeScript and tests.

## Local Setup Flow

The primary no-store installation path is:

```bash
pnpm setup
pnpm link:chrome <extension-id>
pnpm run doctor
```

The setup wizard writes `~/.fluent-frame/config.json`, builds the extension,
installs the native host wrapper, and opens `chrome://extensions`. Chrome still
requires the user to click `Load unpacked` manually.

The extension popup sends a `healthCheck` message through the background service
worker to the native host. The response reports native-host connectivity,
selected agent, tool paths, and dependency availability.

## Quality Gates

Local gate:

```bash
pnpm verify:local
```

Browser/native-host integration:

```bash
pnpm e2e
```

Prompt/schema quality check:

```bash
pnpm eval:ai
```
