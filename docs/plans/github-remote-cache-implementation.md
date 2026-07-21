# GitHub Remote Cache Implementation Plan

> **For agentic workers:** Use test-driven implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional GitHub-backed remote cache so FluentFrame can reuse generated learning subtitle data before rerunning local agents.

**Architecture:** The native host gains a `RemoteCacheProvider` abstraction and a GitHub Contents API implementation. `processVideo` checks local cache, then remote cache, then local generation; successful generated and partial-ready results are written locally and optionally uploaded remotely.

**Tech Stack:** TypeScript, Node fetch, GitHub REST Contents API, Vitest, existing native-host config/cache/queue modules.

---

### Task 1: GitHub Remote Cache Config

**Files:**
- Modify: `apps/native-host/src/config.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/hostResponse.ts`
- Test: `apps/native-host/tests/config.test.ts`
- Test: `packages/shared/tests/protocol.test.ts`

- [ ] Add `RemoteCacheConfig` and parse `remoteCache` from `~/.fluent-frame/config.json`.
- [ ] Validate provider, owner, repo, branch, basePath, writeEnabled, and tokenEnv conservatively.
- [ ] Include remote cache status in `HostHealth`.
- [ ] Verify invalid config disables remote cache instead of crashing native host startup.

### Task 2: GitHub Provider

**Files:**
- Create: `apps/native-host/src/remoteCache.ts`
- Create: `apps/native-host/tests/remoteCache.test.ts`

- [ ] Define `RemoteCacheProvider` with `readResult` and `writeResult`.
- [ ] Implement GitHub Contents API GET for `result.json`.
- [ ] Implement GitHub Contents API PUT with existing-file SHA handling.
- [ ] Validate downloaded JSON with existing learning subtitle result validation.
- [ ] Treat 404 as miss and other failures as non-fatal remote errors.

### Task 3: Processor Integration

**Files:**
- Modify: `apps/native-host/src/processor.ts`
- Modify: `apps/native-host/src/processVideoRequestHandler.ts`
- Test: `apps/native-host/tests/processor.test.ts`

- [ ] Check remote cache after local miss and write a remote hit into local cache.
- [ ] Upload generated and partial-ready results after local cache write.
- [ ] Do not upload source-only fallback results.
- [ ] Emit progress messages for remote cache checking and remote cache hits.

### Task 4: Queue Integration

**Files:**
- Modify: `apps/native-host/src/queueRequestHandler.ts`
- Test: `apps/native-host/tests/queueWorker.test.ts`
- Test: `apps/native-host/tests/router.test.ts`

- [ ] Include remote cache in enqueue `cacheReady` detection.
- [ ] Pass remote cache config env vars to detached workers.
- [ ] Ensure remote cache hit marks queue jobs ready without starting generation.

### Task 5: Docs and Verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/local-development-installation.md`
- Create or modify: `docs/logging.md`

- [ ] Document GitHub cache config and token setup.
- [ ] Run targeted tests while developing.
- [ ] Run `pnpm verify:local`.
- [ ] Run `pnpm e2e`.

