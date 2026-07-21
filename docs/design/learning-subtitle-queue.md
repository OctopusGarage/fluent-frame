# FluentFrame Learning Subtitle Queue Design

## Goal

FluentFrame should let users select YouTube videos ahead of time and generate learning subtitles in the background, so opening a video later usually loads from cache instead of waiting for local Codex or Claude generation.

The queue starts automatically immediately after a video is enqueued. Users should not need to open each video page and click generate one by one.

## Current Flow

```text
YouTube watch page
  -> content script
  -> background service worker
  -> native host processVideo
  -> download captions with yt-dlp
  -> generate learning subtitles with local agent batches
  -> write result to ~/.fluent-frame/cache
  -> return result to current tab
```

This is reliable but too slow at watch time. The generation cost is paid exactly when the user wants to watch.

## Proposed Flow

```text
User adds video to queue
  -> background service worker sends enqueueVideo
  -> native host stores durable queue job
  -> queue runner starts immediately
  -> queue runner processes one job at a time
  -> processVideo writes the existing cache format
  -> later watch page reads cached learning subtitles
```

Chrome collects video IDs and displays status. The native host owns durable queue state and execution.

## Architecture

```text
Chrome extension
  |
  +-- popup UI
  |     - add current video
  |     - paste YouTube URL
  |     - show queue status
  |     - retry or remove jobs
  |
  +-- YouTube content script
  |     - add current watch video to queue
  |     - later add buttons to video cards
  |
  +-- background service worker
        - validates extension messages
        - forwards queue requests to native host

Native host
  |
  +-- QueueStore
  |     - persists jobs to ~/.fluent-frame/queue/jobs.json
  |     - deduplicates by videoId + captionLanguage + workflowVersion
  |
  +-- QueueRunner
  |     - starts automatically after enqueue
  |     - processes one job at a time
  |     - recovers queued/running jobs after native-host restart
  |
  +-- Processor
  |     - existing processVideo pipeline
  |     - writes existing cache result
  |
  +-- Cache
        - existing ~/.fluent-frame/cache layout
```

## Native Host Queue Model

Queue jobs are stored under:

```text
~/.fluent-frame/
  queue/
    jobs.json
  cache/
  notes.json
```

Job shape:

```ts
type QueueJobStatus = "queued" | "running" | "done" | "failed" | "skipped";

type QueueJob = {
  id: string;
  videoId: string;
  url?: string;
  title?: string;
  captionLanguage: string;
  workflowVersion: string;
  status: QueueJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};
```

`id` should be deterministic for the generation identity:

```text
<videoId>:<captionLanguage>:<workflowVersion>
```

This makes enqueue naturally idempotent.

## Queue Rules

- If a generated cache entry already exists, enqueue returns the existing/done state and does not run generation.
- If a matching job is `queued`, enqueue returns that job with a message like `Already queued`.
- If a matching job is `running`, enqueue returns that job with a message like `Already generating`.
- If a matching job is `done`, enqueue returns that job with a message like `Already ready`.
- If a matching job is `failed`, enqueue does not create a duplicate; the UI should offer `Retry`.
- The runner processes one job at a time by default.
- A native-host restart changes stale `running` jobs back to `queued`, unless the cache is already present.
- Source-only fallback results should not be treated as successfully generated learning subtitles unless the existing processor cache policy says they are cacheable.

## Native Host Requests

Add these request types to the shared protocol:

```ts
type HostRequest =
  | { id: string; type: "enqueueVideo"; videoId: string; url?: string; title?: string; captionLanguage: string }
  | { id: string; type: "getQueue" }
  | { id: string; type: "removeQueueJob"; jobId: string }
  | { id: string; type: "retryQueueJob"; jobId: string };
```

Add these response types:

```ts
type HostResponse =
  | { id: string; ok: true; type: "queue"; queue: QueueState }
  | { id: string; ok: true; type: "queueJob"; job: QueueJob; message: string };

type QueueState = {
  paused: false;
  runningJobId?: string;
  jobs: QueueJob[];
};
```

Pause/resume is intentionally left out of the first implementation. Auto-start is required and keeps the first interface smaller.

## Chrome UI

First implementation:

- Popup has `Add current video` and a URL input.
- Popup shows compact queue status:
  - current running job
  - queued count
  - done count
  - failed count
- Popup supports retry and remove.
- Watch page can add the current video through the existing FluentFrame panel or badge area.

Later implementation:

- Add queue buttons to YouTube search, playlist, and channel video cards.
- Add a full queue manager page if popup density becomes a problem.

## Error Handling

- Invalid YouTube URLs are rejected in Chrome before native host calls where possible.
- Native host validates every request with shared protocol parsers.
- Queue file corruption returns a queue error and preserves the corrupt file as a backup before creating a fresh queue.
- Agent, caption download, and cache failures mark the job `failed` with a readable error.
- Retrying a failed job clears `error`, updates timestamps, and starts the runner.

## Testing

Native-host tests:

- enqueue creates one durable job.
- duplicate enqueue returns the same job.
- enqueue skips already cached videos.
- runner processes queued jobs one at a time.
- failed generation marks job failed.
- retry failed job requeues it.
- stale running jobs recover after restart.

Extension tests:

- popup sends valid enqueue messages.
- background forwards queue requests to native host.
- invalid video URLs are rejected.
- queue status renders running, queued, done, and failed states.

E2E tests:

- enqueue a video through the extension.
- native host writes cache.
- opening the same YouTube watch page loads learning subtitles from cache without requiring manual generation.

## Implementation Order

1. Shared queue types and protocol parsing.
2. Native `QueueStore` and tests.
3. Native `QueueRunner` and tests.
4. Native host request handlers.
5. Background service worker forwarding.
6. Popup queue controls.
7. Watch page enqueue control.
8. E2E coverage for enqueue-to-cache-to-watch.

## Non-Goals

- Parallel generation.
- Cloud LLM APIs.
- Chrome Web Store distribution.
- Full playlist scraping in the first implementation.
- Queue sync across machines.

## Decisions

- Failed jobs require manual retry. Automatic retry is deferred to avoid local-agent loops.
- Queue buttons on YouTube search, playlist, and channel video cards are deferred until the popup and watch-page queue flow is stable.
