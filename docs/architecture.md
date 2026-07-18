# Architecture

FluentFrame is split into three layers:

```text
apps/extension      Chrome extension UI, service worker, and YouTube page integration
apps/native-host    local Node process launched by Chrome Native Messaging
packages/shared     protocol types and validators used by both sides
```

## Trust Boundary

Chrome extension JavaScript cannot run local commands. FluentFrame uses Chrome
Native Messaging:

```text
chrome.runtime.sendNativeMessage("com.octopusgarage.fluent_frame", request)
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
  -> local agent CLI returns subtitle + phrase JSON
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
├── cache/<videoId>/<language>/<workflowVersion>/result.json
└── notes.json
```

Browser-side generation timing estimates are stored in YouTube page localStorage:

```text
fluentFrame.generationHistory.v1
```

## Main Protocol Types

`packages/shared` defines:

- `HostRequest`
- `HostResponse`
- `LearningSubtitleResult`
- `SubtitleCue`
- `PhraseExplanation`
- `PersonalNote`

Both extension and native host import these types so protocol drift is caught by
TypeScript and tests.

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
