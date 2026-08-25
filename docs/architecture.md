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
  -> optional GitHub remote cache lookup
  -> yt-dlp downloads English captions as SRT
  -> configured Codex or Claude CLI returns subtitle + phrase JSON
  -> result validator enforces schema and references
  -> source SRT timing is merged back into agent output
  -> result is cached and returned to Chrome
```

The original SRT remains the timing authority. Agent output may correct English,
add Chinese text, and create learning events, but it must not redefine playback
timing.

## GitHub Remote Cache

GitHub remote cache is optional and user-configured. The native host treats it as
a secondary cache provider, not as the primary database:

```text
local result.json
  -> GitHub result.json
  -> local generation
  -> local result.json
  -> optional GitHub upload
```

Remote cache artifacts use the same identity as the local cache:

```text
<basePath>/<videoId>/<language>/<workflowVersion>/result.json
```

The repository owner, repo, branch, base path, write flag, and token environment
variable are read from `~/.fluent-frame/config.json`. Tokens are read from the
environment and are not stored in config. Remote read/write failures are treated
as cache misses or non-fatal upload failures so local generation still works.

## Pre-Generation Queue

FluentFrame can enqueue videos before the user watches them:

```text
Add current video / paste YouTube URL
  -> background service worker creates enqueueVideo request
  -> native host writes ~/.fluent-frame/queue/jobs.json
  -> local/GitHub cache hit marks the job ready immediately
  -> queue runner starts automatically
  -> one queued job is processed at a time
  -> processVideo writes the normal cache result
  -> later watch page loads the cached result
```

The queue is idempotent by `videoId + captionLanguage + workflowVersion`.
Duplicate clicks return the existing job state:

- `Already queued`
- `Already generating`
- `Already ready`
- `Retry required`

The native host keeps queue execution serial so local Codex or Claude does not
run multiple expensive generations at once.

On YouTube watch pages, the background service worker registers Chrome
context-menu actions for YouTube video links and the current watch page. This
keeps recommendation queueing inside the browser's native right-click workflow,
so FluentFrame does not inject controls into YouTube recommendation cards or
compete with other translation/video extensions in the page layout.

## Persistent Data

```text
~/.fluent-frame/
├── bin/native-host
├── config.json
├── cache/<videoId>/<language>/<workflowVersion>/result.json
├── queue/jobs.json
├── logs/native-host.log
└── notes.json
```

The native host writes JSON-line logs for request, queue, metadata, and
generation events. Logs rotate to `native-host.log.1` at 5 MB. See
[logging.md](logging.md).

Browser-side generation timing estimates are stored in YouTube page localStorage:

```text
fluentFrame.generationHistory.v1
```

## Long Videos

FluentFrame does not enforce a fixed video-duration limit or a fixed batch
count. The limiting unit is caption size. The native host derives the number of
batches from the parsed SRT cues, using at most 20 cues per local-agent batch,
then merges the batch outputs back into one `LearningSubtitleResult`. Original
SRT cue IDs and timing remain authoritative.

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
- `QueueJob`
- `QueueState`

Both extension and native host import these types so protocol drift is caught by
TypeScript and tests.

The service worker, popup, and native host may import shared runtime validators
where they cross the native messaging protocol. The YouTube content script keeps
shared protocol imports type-only so its bundle stays self-contained and does
not load a shared runtime chunk on the page.

## Local Setup Flow

The primary no-store installation path is:

```bash
pnpm local:install
pnpm link:chrome <extension-id>
pnpm run doctor
```

`pnpm setup` remains available as an alias for `pnpm local:install`.

The setup wizard writes `~/.fluent-frame/config.json`, builds the extension,
installs the native host wrapper, and opens `chrome://extensions`. Chrome still
requires the user to click `Load unpacked` manually.

The extension popup sends a `healthCheck` message through the background service
worker to the native host. The response reports native-host connectivity,
selected agent, tool paths, and dependency availability.

## Quality Gates

Workspace preflight:

```bash
pnpm typecheck
pnpm test
```

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
