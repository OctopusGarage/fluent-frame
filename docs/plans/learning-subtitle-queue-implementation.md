# Learning Subtitle Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-starting, durable queue so users can select YouTube videos ahead of time and generate FluentFrame learning subtitles before watching.

**Architecture:** Chrome gathers video IDs and sends queue commands through the existing background native-message module. The native host owns durable queue state in `~/.fluent-frame/queue/jobs.json`, runs one job at a time, and reuses the existing `processVideo` pipeline so generated output lands in the current cache format.

**Tech Stack:** TypeScript, Chrome extension MV3, native messaging, Node filesystem APIs, Vitest, Playwright.

---

## File Structure

- Modify `packages/shared/src/protocol.ts`: add queue types, request parsing, and response union entries.
- Modify `packages/shared/src/hostResponse.ts`: validate queue responses.
- Add `apps/native-host/src/queueStore.ts`: durable queue read/write, idempotent enqueue, remove, retry, stale-running recovery.
- Add `apps/native-host/src/queueRunner.ts`: single-flight runner that processes queued jobs with `processVideo`.
- Add `apps/native-host/src/queueRequestHandler.ts`: maps native host queue requests to `QueueStore` and `QueueRunner`.
- Modify `apps/native-host/src/config.ts`: expose `queueFile`.
- Modify `apps/native-host/src/hostRequestHandlers.ts`: dispatch queue requests.
- Modify `apps/extension/src/background.ts`: create and forward queue requests.
- Modify `apps/extension/src/popup.html` and `apps/extension/src/popup.ts`: add current-video enqueue, paste-URL enqueue, and compact queue status.
- Modify `apps/extension/src/uiTemplate.ts`, `apps/extension/src/ui.ts`, `apps/extension/src/content.ts`: add watch-page enqueue control and message handling.
- Add or modify tests in `packages/shared/tests/protocol.test.ts`, `apps/native-host/tests/queueStore.test.ts`, `apps/native-host/tests/queueRunner.test.ts`, `apps/native-host/tests/router.test.ts`, `apps/extension/tests/background.test.ts`, `apps/extension/tests/popup.test.ts`, `apps/extension/tests/content.test.ts`, and `e2e/extension.spec.ts`.

## Task 1: Shared Queue Protocol

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/hostResponse.ts`
- Test: `packages/shared/tests/protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Add tests that assert:

```ts
expect(parseHostRequest({
  id: "queue1",
  type: "enqueueVideo",
  videoId: "dQw4w9WgXcQ",
  captionLanguage: "en",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
})).toEqual({
  id: "queue1",
  type: "enqueueVideo",
  videoId: "dQw4w9WgXcQ",
  captionLanguage: "en",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
});

expect(parseHostRequest({ id: "queue2", type: "getQueue" })).toEqual({ id: "queue2", type: "getQueue" });
expect(parseHostRequest({ id: "queue3", type: "removeQueueJob", jobId: "dQw4w9WgXcQ:en:2026-07-20-learning-cues-1" }))
  .toMatchObject({ type: "removeQueueJob" });
expect(parseHostRequest({ id: "queue4", type: "retryQueueJob", jobId: "dQw4w9WgXcQ:en:2026-07-20-learning-cues-1" }))
  .toMatchObject({ type: "retryQueueJob" });
```

Also test `parseHostResponse` accepts:

```ts
{
  id: "queue1",
  ok: true,
  type: "queueJob",
  message: "Queued",
  job: {
    id: "dQw4w9WgXcQ:en:2026-07-20-learning-cues-1",
    videoId: "dQw4w9WgXcQ",
    captionLanguage: "en",
    workflowVersion: WORKFLOW_VERSION,
    status: "queued",
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  },
}
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @fluent-frame/shared test -- protocol.test.ts
```

Expected: tests fail because queue request/response types are unsupported.

- [ ] **Step 3: Implement shared queue types and parsers**

Add:

```ts
export type QueueJobStatus = "queued" | "running" | "done" | "failed" | "skipped";

export type QueueJob = {
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

export type QueueState = {
  paused: false;
  runningJobId?: string;
  jobs: QueueJob[];
};
```

Extend `HostRequest`, `HostResponse`, `parseHostRequest`, and `parseHostResponse`. Add a safe `parseQueueJobId` that accepts deterministic IDs like `<videoId>:<language>:<workflowVersion>` and rejects path traversal.

- [ ] **Step 4: Verify shared package**

Run:

```bash
pnpm --filter @fluent-frame/shared test -- protocol.test.ts
pnpm --filter @fluent-frame/shared build
```

Expected: both pass.

## Task 2: Native Queue Store

**Files:**
- Add: `apps/native-host/src/queueStore.ts`
- Modify: `apps/native-host/src/config.ts`
- Test: `apps/native-host/tests/queueStore.test.ts`

- [ ] **Step 1: Write failing QueueStore tests**

Cover:

```ts
const store = createQueueStore(queueFile, { now: () => "2026-07-21T00:00:00.000Z" });
const first = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
const second = await store.enqueue({ videoId: "dQw4w9WgXcQ", captionLanguage: "en" });
expect(second.job.id).toBe(first.job.id);
expect(second.message).toBe("Already queued");
```

Also cover remove, retry failed job, `getQueue`, corrupt queue backup, and `recoverStaleRunningJobs`.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- queueStore.test.ts
```

Expected: fails because `queueStore.ts` does not exist.

- [ ] **Step 3: Implement QueueStore**

Interface:

```ts
export type QueueStore = {
  enqueue(input: { videoId: string; captionLanguage: string; url?: string; title?: string; cacheReady?: boolean }): Promise<{ job: QueueJob; message: string }>;
  getQueue(): Promise<QueueState>;
  remove(jobId: string): Promise<QueueState>;
  retry(jobId: string): Promise<{ job: QueueJob; message: string }>;
  claimNext(): Promise<QueueJob | undefined>;
  markDone(jobId: string): Promise<QueueJob>;
  markFailed(jobId: string, error: string): Promise<QueueJob>;
  recoverStaleRunningJobs(): Promise<void>;
};
```

Use atomic writes: write to `jobs.json.tmp`, then rename to `jobs.json`.

- [ ] **Step 4: Add config path**

Modify `HostConfig`:

```ts
queueFile: string;
```

Set default:

```ts
queueFile: env.FF_QUEUE_FILE ?? localConfig.queueFile ?? join(dataDir, "queue", "jobs.json")
```

- [ ] **Step 5: Verify native QueueStore**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- queueStore.test.ts
pnpm --filter @fluent-frame/native-host build
```

Expected: both pass.

## Task 3: Native Queue Runner

**Files:**
- Add: `apps/native-host/src/queueRunner.ts`
- Add: `apps/native-host/tests/queueRunner.test.ts`

- [ ] **Step 1: Write failing QueueRunner tests**

Test:

```ts
const runner = createQueueRunner({
  store,
  processJob: async (job) => processed.push(job.id),
});
await runner.start();
await runner.start();
expect(processed).toEqual(["dQw4w9WgXcQ:en:2026-07-20-learning-cues-1"]);
```

Also test serial processing and failed jobs.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- queueRunner.test.ts
```

Expected: fails because `queueRunner.ts` does not exist.

- [ ] **Step 3: Implement QueueRunner**

Interface:

```ts
export type QueueRunner = {
  start(): void;
  isRunning(): boolean;
};
```

Implementation should:

- guard with one `running` boolean
- call `store.recoverStaleRunningJobs()` once at startup
- loop `claimNext()`
- call injected `processJob(job)`
- call `markDone` or `markFailed`
- continue to the next queued job

- [ ] **Step 4: Verify QueueRunner**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- queueRunner.test.ts
```

Expected: pass.

## Task 4: Native Queue Request Handler

**Files:**
- Add: `apps/native-host/src/queueRequestHandler.ts`
- Modify: `apps/native-host/src/hostRequestHandlers.ts`
- Test: `apps/native-host/tests/router.test.ts`

- [ ] **Step 1: Write failing router tests**

Add tests for:

- `enqueueVideo` returns `queueJob` and creates a queue file.
- Duplicate `enqueueVideo` returns `Already queued`.
- `getQueue` returns jobs.
- `removeQueueJob` removes queued/failed/done jobs.
- `retryQueueJob` requeues failed jobs.

- [ ] **Step 2: Run failing router tests**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- router.test.ts
```

Expected: queue request tests fail.

- [ ] **Step 3: Implement queue request handler**

Create a module that builds:

```ts
createQueueRequestHandler(config: HostConfig): {
  enqueueVideo(request): Promise<HostResponse>;
  getQueue(request): Promise<HostResponse>;
  removeQueueJob(request): Promise<HostResponse>;
  retryQueueJob(request): Promise<HostResponse>;
}
```

Use existing `readCachedResult(config.cacheDir, videoId, captionLanguage)` to mark already cached videos as `done`.

- [ ] **Step 4: Wire request handlers**

Add queue request entries in `hostRequestHandlers.ts` and map errors to:

```ts
{ ok: false, type: "error", code: "QUEUE_ERROR", message }
```

- [ ] **Step 5: Verify native routing**

Run:

```bash
pnpm --filter @fluent-frame/native-host test -- router.test.ts queueStore.test.ts queueRunner.test.ts
```

Expected: pass.

## Task 5: Extension Background Queue Forwarding

**Files:**
- Modify: `apps/extension/src/background.ts`
- Test: `apps/extension/tests/background.test.ts`

- [ ] **Step 1: Write failing background tests**

Cover:

```ts
getListener()({
  type: "enqueueVideo",
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Video title",
}, {}, sendResponse);
expect(nativeRequest).toMatchObject({
  type: "enqueueVideo",
  videoId: "dQw4w9WgXcQ",
  captionLanguage: "en",
});
```

Also cover `getQueue`, `removeQueueJob`, and `retryQueueJob`.

- [ ] **Step 2: Run failing background tests**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- background.test.ts
```

Expected: queue forwarding tests fail.

- [ ] **Step 3: Implement request creators and listeners**

Add `createEnqueueVideoRequest`, `createGetQueueRequest`, `createRemoveQueueJobRequest`, and `createRetryQueueJobRequest`. Route extension messages through `sendNativeRequest`.

- [ ] **Step 4: Verify background**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- background.test.ts
```

Expected: pass.

## Task 6: Popup Queue UI

**Files:**
- Modify: `apps/extension/src/popup.html`
- Modify: `apps/extension/src/popup.ts`
- Add or modify: `apps/extension/tests/popup.test.ts`

- [ ] **Step 1: Write failing popup tests**

Test current-tab enqueue, pasted URL enqueue, invalid URL status, and queue rendering:

```ts
expect(document.getElementById("queue-summary")?.textContent).toContain("Queued 1");
expect(document.getElementById("queue-running")?.textContent).toContain("Generating");
```

- [ ] **Step 2: Run failing popup tests**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- popup.test.ts
```

Expected: fails because popup queue UI does not exist.

- [ ] **Step 3: Implement popup HTML**

Add:

```html
<button id="enqueue-current" type="button">Add current video to queue</button>
<form id="enqueue-url-form">
  <input id="enqueue-url" type="url" placeholder="Paste YouTube URL" />
  <button type="submit">Queue</button>
</form>
<section id="queue-card" aria-label="Generation queue">
  <div id="queue-summary"></div>
  <div id="queue-running"></div>
  <div id="queue-list"></div>
</section>
```

- [ ] **Step 4: Implement popup behavior**

Add URL parsing for:

- `https://www.youtube.com/watch?v=<id>`
- `https://youtu.be/<id>`

Send messages:

```ts
chrome.runtime.sendMessage({ type: "enqueueVideo", videoId, url, title });
chrome.runtime.sendMessage({ type: "getQueue" });
```

Render compact queue status with retry/remove buttons.

- [ ] **Step 5: Verify popup**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- popup.test.ts
pnpm --filter @fluent-frame/extension build
```

Expected: pass.

## Task 7: Watch Page Queue Control

**Files:**
- Modify: `apps/extension/src/uiTemplate.ts`
- Modify: `apps/extension/src/ui.ts`
- Modify: `apps/extension/src/content.ts`
- Test: `apps/extension/tests/content.test.ts`
- Test: `apps/extension/tests/ui.test.ts`

- [ ] **Step 1: Write failing UI/content tests**

Assert the panel renders an enqueue control and clicking it sends one `enqueueVideo` message for the current video.

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- content.test.ts ui.test.ts
```

Expected: enqueue-control tests fail.

- [ ] **Step 3: Add UI interface**

Extend `CoachUiOptions`:

```ts
onEnqueueVideo?: () => void;
```

Add a button near the generate command:

```html
<button id="ff-enqueue" class="ff-command" type="button">Add to queue</button>
```

- [ ] **Step 4: Wire content script**

When clicked:

```ts
runtime.sendMessage({
  type: "enqueueVideo",
  videoId,
  url: doc.location.href,
  title: doc.title,
});
```

Show status from `queueJob.message`.

- [ ] **Step 5: Verify watch-page queue control**

Run:

```bash
pnpm --filter @fluent-frame/extension test -- content.test.ts ui.test.ts
```

Expected: pass.

## Task 8: E2E and Full Verification

**Files:**
- Modify: `e2e/extension.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/manual-verification.md`

- [ ] **Step 1: Add E2E coverage**

Extend the local e2e mock native host to accept `enqueueVideo` and write a cache result. Then assert opening the same watch page displays learning subtitles without clicking `Generate learning subtitles`.

- [ ] **Step 2: Update docs**

Document:

- popup queue usage
- automatic queue start
- idempotent duplicate click behavior
- queue storage path

- [ ] **Step 3: Run complete verification**

Run:

```bash
pnpm verify:local
pnpm e2e
pnpm eval:ai
```

Expected:

- local lint/typecheck/unit/script/build/audit all pass
- e2e extension flow passes
- live YouTube e2e remains skipped unless `FF_LIVE_YOUTUBE=1`
- AI eval passes

## Self-Review

- Spec coverage: every requirement in `docs/design/learning-subtitle-queue.md` maps to a task above.
- Placeholder scan: no deferred placeholders remain in this plan; later-phase card buttons are explicitly non-goal for first implementation.
- Type consistency: queue status, job shape, request names, and response names match across shared protocol, native host, extension, and tests.
