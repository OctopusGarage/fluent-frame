# Native-host queue ownership deepening

## Scope and phase

External implementation phase only; no commits, branch changes, publishing, PRs, or external service mutations. Native review, final system acceptance, verified commit and PR delivery are pending bot-owned actions. Target 95 is supplied to the scheduled architecture assessment; no measured score is available and none is claimed.

## Pre-mutation observations and evidence

- Baseline HEAD: `2101b4b` (`fix(native-host): fence stale queue claim updates (#85)`). The only initial untracked path was caller-owned `.ralph/`, left untouched.
- Read `README.md`, `CONTRIBUTING.md`, `CONTEXT.md`, `docs/architecture.md`, ADR 0001, package scripts, `scripts/verify-local.sh`, CI workflow, architecture guards, coverage runner, AI evaluation runner, queue store/runner/processor/runtime, and persistence tests. No AGENTS.md or separate GLOSSARY.md was found; domain vocabulary is in CONTEXT.md. ADR 0001 supports concentrating effectful implementation at stable seams.
- Recent history confirms a maintenance hotspot: #85 changed store, runner, processor and shared queue parsing for claim fencing; #84 changed store and runner for stale recovery; #83 changed store cache reconciliation.
- Concrete maintenance cost: `touchRunning`, `markProgress`, `markDone`, and `markFailed` each duplicate lock acquisition, disk reread, running-status/claim-ID fencing, replacement and persistence. A fencing or persistence change needs four synchronized edits. Missing-job semantics differ intentionally (heartbeat/progress return undefined, terminal updates throw).
- Confirmed runtime path: `queueRuntime -> queueRunner -> QueueStore`; `queueRuntime -> queueProcessor -> QueueStore.markProgress`; request/coordinator paths also use QueueStore. QueueStore currently imports shared parsing/types and filesystem/crypto/atomic JSON writing. Shared has no app dependency, and extension has no native-host dependency. No cycle is evident on this path (not a claim of whole-project cycle analysis).
- Observable contract: claim fencing and disk reread must occur under the same lock; rejected ownership must not write, sample the clock, or change the replacement run. Terminal updates remove claimId; progress/heartbeat retain it. Terminal missing jobs throw exactly `Queue job not found`; heartbeat/progress missing jobs are no-ops. Legacy jobs without claimId remain parseable and recover through stale recovery, not old-worker updates.

## Candidate comparison and selected plan (recorded before implementation)

1. **Keep existing design:** no migration cost, but repeated ownership/persistence code remains. Evidence strength: strong (four matching implementations and recent fix).
2. **Private fenced-update helper only:** smallest diff and useful deduplication, but storage locking/normalization/corrupt recovery remain intertwined with queue transitions. Worth considering; less isolation of persistence decisions.
3. **Selected: deepen a file-backed queue repository:** one cohesive structural change. Extract filesystem lock/read/normalization/atomic persistence into `queueRepository.ts`. Its small interface reads snapshots, runs synchronous queue decisions transactionally, and applies a fenced running-job mutation. QueueStore retains every exported method and all domain transitions; runner/processor callers remain unchanged. No speculative alternative storage adapter or new framework. The repository owns authoritative state on disk, with no mirrored state or caller-owned snapshots accepted for fenced writes.

Deletion test: deleting the repository would put lock/reread/no-write-on-rejection rules back into the store's four mutation paths and general transactions. This is policy-bearing depth rather than a forwarding facade. Tradeoff: one extra internal module and a synchronous transaction decision type. Callbacks are internal pure transforms, not external observers; processing, logging, waits and heartbeat timers remain outside locks.

### Planned behavior probes and verification

Before moving responsibilities, add public QueueStore contract tests for all four writes after recovery/reclaim, no disk rewrite/clock read on rejected ownership, missing/non-running/legacy jobs, terminal field cleanup and successful persistence. Retain existing interacting two-runner recovery tests and persistence-error/timer-cleanup assertions. Then run the probes before and after extraction.

Run unchanged `pnpm verify:local` (lint, typecheck, coverage, build, audit; initially assumed high-only, corrected from actual execution below), `pnpm test` explicitly, and `pnpm e2e`. Use invocation-scoped `VITEST_MAX_WORKERS=1`; serialize heavy suites. Browser uses only a fresh task-owned short `/tmp` directory through MAC_CHROMIUM_TMPDIR, with ordinary TMPDIR and pinned Chromium/options/timeouts/assertions unchanged. No prompt/schema change: live provider AI evaluation is not applicable or authorized.

### Affected-check and evaluation inventory (before edits)

Inspected tracked files and searched scripts/docs/workflows for affected/select commands and original queue paths. This repository has **no affected-check selector or per-path acceptance manifest**. `scripts/verify-local.sh` and `.github/workflows/ci.yml` run unconditional whole-workspace suites; native package test is Vitest discovery. Whole-change, original `apps/native-host/src/queueStore.ts`, and proposed `apps/native-host/src/queueRepository.ts` therefore all receive the same unit/integration/native/architecture/coverage/build gates and unconditional CI browser job. There is no selector CLI to invoke per path; this is an explicit tooling limitation, not a fabricated selector result.

Coverage enumerates every package `src/` file dynamically in `scripts/coverage-tools/run.mjs`; the new owner will be included without manifest edits. Architecture guards recursively scan native-host source/tests. `scripts/ai-eval.mjs` supplies only the subtitle prompt and SRT to a live agent; it imports built quality validation, not queue source. No queue semantic evaluation context list exists in tracked files. Original-path references in `docs/plans/learning-subtitle-queue-implementation.md` are historical implementation instructions, not active selectors; they remain historical. CONTEXT.md and architecture docs will record current ownership. Guard files and script meanings will stay unchanged.

## Verification log

- Initial read-only inventory: succeeded; Node v26.6.0 and pnpm 10.13.1 observed. Lockfile and node_modules exist. Scheduled dependency/install and architecture assessment checks have not run in this phase.
- One exploratory read of nonexistent `scripts/coverage-tools/manifest.mjs` returned ENOENT; actual manifest generation is inline in `run.mjs`, read successfully.

### Pre-extraction contract results

- Focused native tests initially could not resolve shared built exports (0 tests). Built shared with its existing command; no source change needed.
- First contract run after that build: 33/34 passed. The new legacy fixture incorrectly used `paused: true`, which the existing parser rejects. Corrected the fixture to the actual `paused: false` contract; no production policy changed.
- `VITEST_MAX_WORKERS=1 pnpm --filter @fluent-frame/native-host test queueStore.test.ts queueRunnerPersistence.test.ts`: **34/34 passed**, 2 files, 396ms, against the original production implementation. This establishes behavior before extraction.

### Initial extraction and prerequisite diagnosis

- Extracted file-backed repository; QueueStore now submits synchronous decisions and four owned writes use one locked `updateRunning` implementation. First post-extraction focused run: **34/34 passed**, 400ms; native-host typecheck passed.
- Read-only built-in audit (`pnpm audit`) failed on baseline Vite 7.3.6: GHSA-587h-7wmj-h5pm, patched in 7.3.7. Also reports seven moderate and one low advisory. Initial interpretation (later disproven below): only the high Vite advisory blocks the gate. Initial plan: minimum compatible Vite 7.3.7 update, retain other compatible transitive resolutions; do not update unrelated moderate advisories. This is an explicitly permitted dependency prerequisite, not a second architecture change. Inspect lockfile diff and explain any necessary transitive update before retaining it.

- `pnpm --filter @fluent-frame/extension update vite@7.3.7` succeeded, but refreshed compatible esbuild, Rollup, picomatch and estree resolutions unnecessarily. Inspected Vite 7.3.7's dependency ranges: the existing versions satisfy all of them. Restored baseline transitive blocks and kept only Vite's new version/integrity plus required peer-context references and the extension minimum range. At this intermediate stage the lock diff was 15 additions/15 deletions; **no other package version changed yet**. `pnpm install --frozen-lockfile --offline` passed on that minimized lockfile (243ms). This execution was needed to synchronize and validate the changed dependency input, not to duplicate the scheduled check. pnpm warned that esbuild build scripts were ignored; build verification will establish whether the existing binary works.
- Added direct repository tests for lock-time authoritative reread, observation of the held lock and old disk snapshot during a decision, persistence-before-return, callback rejection cleanup, no-write decisions versus empty writes, and missing-job semantics. These complement (not replace) public QueueStore and interacting runner regressions.

- Final focused seam run after minimized dependency update: `VITEST_MAX_WORKERS=1 pnpm --filter @fluent-frame/native-host test queueStore.test.ts queueRepository.test.ts queueRunnerPersistence.test.ts`: **38/38 passed**, 3 files, 511ms; native-host typecheck passed again. Whole local gate begins with ~60 minutes remaining; use a 15-minute foreground command bound, leaving ample report/browser/assessment time.

### Whole local gate: first result and corrected audit interpretation

- `VITEST_MAX_WORKERS=1 pnpm verify:local`: lint/typecheck/coverage/build passed; audit failed. Coverage: extension 182 tests/18 files, native 176/29, shared 42/3; workspace lines **3091/3750 (82.42%)**, above unchanged 80% threshold. Build used Vite 7.3.7 successfully, including existing esbuild binary.
- Important observed script distinction: `scripts/verify-local.sh` invokes **built-in `pnpm audit`**, NOT package script `pnpm run audit`. pnpm help confirms default audit level is low. Earlier high-only gate interpretation was incorrect; the actual unchanged local/CI gate blocks on the four remaining moderate advisories too. Plan revised before additional dependency changes: Vitest/coverage 4.1.12 (paired patch update) for two mocker advisories, plus narrowly scoped test-exclude glob/minimatch overrides to patched versions. Registry metadata confirms c8 12.0.0/test-exclude 8.0.0 are latest but constrain vulnerable glob 13/minimatch 10, so no compatible parent patch exists. Glob 14.0.2 and minimatch 11.0.1 support this Node runtime; behavior must be validated by all original script/coverage gates. Preserve unrelated compatible resolutions and audit severity/scripts unchanged.

- Prerequisite resolution: `pnpm install --lockfile-only` succeeded (4.5s), `pnpm install --frozen-lockfile` succeeded (1.6s, downloaded only authorized prerequisite packages), then built-in `pnpm audit` passed: **No known vulnerabilities found**. Final lock changes are Vite 7.3.7, paired Vitest packages 4.1.12, glob 14.0.2, minimatch 11.0.1, and glob's required path-scurry 3.0.0/new `@isaacs/nonrecursive-glob-match` dependency. Existing esbuild, Rollup, picomatch and estree resolutions are preserved. Scoped overrides are necessary because latest c8/test-exclude still constrain vulnerable major versions. No audit ignores, severity reductions, test-script or CI-script changes.

- Reran unchanged `VITEST_MAX_WORKERS=1 pnpm verify:local` after dependency changes: **passed** lint, typecheck, all coverage suites (400 workspace tests + 74 script tests), workspace 82.42% line coverage, build, and built-in audit (no known vulnerabilities). No thresholds or suite inventory were reduced.

- Explicit `VITEST_MAX_WORKERS=1 pnpm test`: **passed**, all 400 workspace tests plus 74 script tests. This is the requested verification command, distinct from the local gate's coverage invocation.

- First unchanged `pnpm e2e` attempt with supported fresh MAC_CHROMIUM_TMPDIR: build passed, functional browser test failed before launch because pinned Playwright Chromium revision 1243 is missing on this executor; live-provider test skipped by existing opt-in. No assertions ran. Task-owned temp directory was cleaned after command/browser exit. CI documents `pnpm exec playwright install chromium`; use that existing setup command to obtain the pinned browser, without changing package, executable, launch options, or test timeout.

- CI-documented `pnpm exec playwright install chromium` downloaded the pinned headed Chromium revision 1243 successfully. Its additional headless-shell download hit a network timeout, and the command exceeded the 300s setup bound; confirmed no install/download child remained. The existing suite uses headed Chromium, now present; retry that actual suite rather than changing browsers or installing optional execution modes.

- Second unchanged `pnpm e2e` with fresh task-owned MAC_CHROMIUM_TMPDIR: **passed** build and functional extension/native-messaging browser test (11.4s; total browser phase 11.7s). Existing real-provider live test skipped, as designed without FF_LIVE_YOUTUBE. Ordinary TMPDIR, pinned browser revision, launch options, assertions and 45-second timeout were unchanged. Cleaned only the task-owned directory after browser exit; no install/download or task-browser process remained.
- Final `git diff --check`: passed. After report updates, `VITEST_MAX_WORKERS=1 pnpm test:scripts` passed again: 74/74 script tests, no skips (2.66s). Compared root scripts and guarded configs/source against HEAD: verification scripts, architecture guard, tsconfig.json, pnpm-workspace.yaml, playwright.config.ts, e2e/helpers.ts and CI workflow are byte-for-byte unchanged. Report portability check found no executor home paths. Read generated coverage inventory: `apps/native-host/src/queueRepository.ts` is included, with 50/54 statements covered. This is coverage evidence, not an architecture score.

## After-change dependency and behavior evidence

```text
Before: runner / processor / coordinator -> QueueStore
                                           |-- four repeated lock/reread/fence/write paths
                                           `-- filesystem / shared parser / jsonFile
After:  runner / processor / coordinator -> QueueStore (unchanged caller interface)
                                           `-> queueRepository
                                               |-- one updateRunning ownership decision
                                               |-- synchronous transactions + write/no-write decision
                                               `-- filesystem / shared parser / jsonFile
```

Observed imports: QueueStore now imports only crypto, shared workflow/types and queueRepository; queueRepository imports filesystem, path, shared parser/types and jsonFile. No reverse import into QueueStore, runner, processor or extension exists. No new cycle on this path. QueueJob and QueueState formats and exported QueueStore methods are unchanged. The four callers no longer know lock lifetime, disk reread, claim comparison or persistence order. Queue transitions still own field cleanup, timestamps, cache reconciliation and retry behavior. No alternate storage adapter or mirrored authoritative state was introduced.

Ownership and cleanup evidence crosses both interfaces: public QueueStore tests protect the original contract before/after; repository tests observe lock/disk state during the synchronous decision and durable state after return. Existing two-runner tests combine stale recovery, reclaims, late progress/heartbeat, prior success/failure, replacement completion and logs. Existing persistence-failure cases assert no false terminal log, heartbeat timer cleanup, running=false and later recovery. No external observer/publication callback was added; asynchronous processing, logging and timers remain outside the transaction. Cancellation, replacement and timer behavior in runner code are unchanged.

### Final path/check inventory

Reinspected `scripts/verify-local.sh`, `.github/workflows/ci.yml`, `scripts/coverage-tools/run.mjs`, `scripts/tests/architecture-boundaries.test.mjs`, `scripts/ai-eval.mjs`, package scripts and historical queue-plan path references. There is still no repository selector to execute with a single source path. Because CI and local gates are unconditional, the per-path comparison is:

| Input classification | Baseline/current selection |
| --- | --- |
| Original owner `apps/native-host/src/queueStore.ts` | All workspace tests including native queue/store/runner/worker/router tests, script architecture guards, coverage, lint/typecheck/build; CI browser job |
| Extracted owner `apps/native-host/src/queueRepository.ts` | Same unconditional gates; observed discovery of repository tests and inclusion in coverage source inventory |
| `apps/native-host/tests/queueStore.test.ts`, `queueRepository.test.ts` | Test-only inputs; Vitest native-host discovery, full gates unchanged |
| Root package/lock and extension package | Shared verification/dependency inputs; full workspace gates and browser rerun, not native-only verification |
| CONTEXT.md, docs/architecture.md, ARCHITECTURE_REPORT.md | Documentation inputs; script documentation/architecture guards and full gates unchanged |

No moved path lost unit/integration/browser/native acceptance ownership. There is no native queue semantic-agent source list to update; the live prompt evaluation consumes only its existing prompt and SRT and is inapplicable to this extraction. Scheduled architecture assessment inputs remain supplied by the orchestrator, not modified here. This explicitly reports absent selector tooling rather than treating a nonexistent command as passed.

## Delivered files and tradeoffs

- New `apps/native-host/src/queueRepository.ts`: file-backed read/transaction/fenced mutation implementation.
- Updated `apps/native-host/src/queueStore.ts`: existing queue caller interface and transitions, now using the repository.
- New `apps/native-host/tests/queueRepository.test.ts`; expanded `apps/native-host/tests/queueStore.test.ts`: direct seam and compatible contract regressions; no existing assertions removed.
- Updated `CONTEXT.md`, `docs/architecture.md`, and this report: ownership, dependency map, plan and actual results.
- Updated `apps/extension/package.json`, `package.json`, `pnpm-lock.yaml`: only confirmed audit-gate prerequisites and necessary transitive resolutions, described above. Existing scripts, guard files (apart from prerequisite dependency fields in package.json), workspace/TypeScript configurations and browser tests are unchanged.

One structural change delivered, within the maximum of two. The added internal module introduces a transaction-decision concept, but removes repeated effectful ownership checks and has actual production and disk-backed test callers. A private helper alone, generic pluggable storage, runner lifecycle redesign and broader queue state-machine rewrites were deferred.

## Remaining risks and handoff status

- External implementation and required local verification are **complete**. Results apply to this macOS executor; Linux CI is not locally executed. Registry audit is time-sensitive.
- Existing lock stale-unlink policy and unlocked corrupt-file backup behavior were preserved, not proven safe for arbitrarily slow transactions or every filesystem race. Transaction callbacks are internal synchronous decisions and must remain short; TypeScript is not a sandbox against malicious callers.
- Existing generation/cache effects are not cancelled by losing a claim; this work fences queue persistence only. Existing runner logger reentrancy/shutdown concerns are outside this bounded extraction. No new cancellation claim is made.
- The headless-shell setup download did not complete, but it is unused by the required local headed browser suite, which passed. Real provider/live YouTube and prompt AI eval were not run; no prompt/schema changes were made and no provider calls were authorized.
- No per-path affected selector exists; unconditional full checks and actual source discovery provide the available acceptance evidence. No fabricated selector or semantic-assessment result is claimed.
- Scheduled lockfile/pnpm/offline-install/node_modules and architecture assessment checks remain **pending RalphWorks execution** after handoff. An earlier offline install passed before the final paired prerequisite update; the final frozen install passed with registry downloads. The scheduled final offline install must validate the final cached lockfile independently.
- Native review, final system acceptance, measured architecture score, commit verification and PR delivery remain **pending bot-owned work**. No commit, push, PR, merge, retarget, notification or external service mutation was performed. No score is invented and target 95 is not claimed achieved.

## Native recovery delivery — 2026-11-12

The sections above are the preserved implementation-phase report. Their pending items and executor observations describe that earlier phase; the current recovery evidence follows here. The failed-origin run `1794468060000-rw-eval-20261112-ff-arch-ralph` remains failed. Recovery does not revise that result.

### Import and independent review

- Required clean baseline and unchanged comparison base: `2101b4b20f0bf4a53ac85a433c84b8f67b9790ed`. Imported preservation snapshot `79c23d9d34776d204740ed31e743bf0d2d5957d1`, with that exact parent and tree `6e480c75eb0a3794a6d9a3fe428e478b86c56a23`, through `git cherry-pick --no-commit`. Before edits or verification, `git write-tree` matched exactly. The preservation snapshot is not the native delivery commit.
- Two independent native source reviews examined standards and WorkOrder correctness against the exact baseline-to-import diff. Both found zero blocking defects or scope violations. Review covered all owned writes, lock-time authoritative reads, write/no-write decisions, persistence failure propagation, terminal cleanup, missing-job policy, legacy recovery, tests and dependency prerequisites. Inherited stale-lock/corrupt-backup limitations remain as described above.
- One structural change remains: the repository extraction. No native implementation, test, dependency, gate or configuration repair was justified or made. The native repository delta from the snapshot is this documentation appendix only. The snapshot report remains immutable in its Git object; preceding report text is preserved byte-for-byte.

### Fresh recovery verification

Verification commands ran serially on Node 24.13.1 and pnpm 10.13.1; original pnpm workspace scheduling was retained. Vitest file workers were limited per invocation. Bounds below are executor process bounds, not changes to project test timeouts. Full command logs, timestamps, exits, review artifacts and inventory are retained in the recovery run artifacts outside the repository.

| Command | Bound | Actual result |
| --- | --- | --- |
| `test -f pnpm-lock.yaml`; `command -v pnpm`; `pnpm install --frozen-lockfile --offline`; `test -d node_modules` | 180s combined | Exit 0; final imported lockfile installed offline, no resolution changes |
| `VITEST_MAX_WORKERS=1 pnpm verify:local` | 900s | Exit 0 in 33.0s; lint, typecheck, coverage, build, built-in audit passed |
| `VITEST_MAX_WORKERS=1 pnpm test` | 600s | Exit 0 in 12.4s; 400 workspace tests and 74 script tests passed; no skips |
| `pnpm e2e` with fresh invocation-only Chromium temp override | 300s | Initial exit 1 before launch: pinned browser executable absent; one existing live-provider skip |
| `pnpm exec playwright install chromium` | 300s | Exit 0 in 119.7s; documented executor setup installed pinned Chromium revision 1243 |
| Renewed unchanged `pnpm e2e` with a new Chromium temp override | 300s | Exit 0 in 13.0s; functional browser/native-messaging test passed; one existing live-provider test skipped |

Coverage: 3091/3750 workspace lines (82.42%), above unchanged 80% threshold; 400 package tests plus 74 script tests. New repository source is included by the existing dynamic manifest. Built-in `pnpm audit` reported no known vulnerabilities. The ignored esbuild install-script warning did not prevent the unchanged builds or browser acceptance.

The browser environment used a fresh short task-owned directory under `/tmp` for each `MAC_CHROMIUM_TMPDIR` invocation. Ordinary `TMPDIR`, pinned browser, launch options, assertions and functional test timeout (45 seconds) were unchanged. No task browser remained after either command; only each task-owned temp directory was cleaned. The missing-browser failure and its trace were preserved, not hidden by the successful retry.

### Gate inventory and delivery limits

- Local gate is exactly `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, built-in `pnpm audit`. Explicit `pnpm test` and browser acceptance were additionally executed as required by this WorkOrder. The README/CONTRIBUTING shorthand does not replace the actual scripts.
- CI runs frozen install, lint, typecheck, coverage and build on Linux/macOS; audit additionally runs on Linux. Browser CI installs pinned Chromium and runs `pnpm e2e:ci`; `verify` requires both checks and browser jobs to succeed. Gitleaks `scan` targets main/dev only, so it is not triggered by the configured comparison base. The Dependabot auto-merge job is conditional and inapplicable to this recovery PR. Current CI/mergeability are recorded after publication in run artifacts.
- Root script meanings, local gate, coverage runner/threshold, architecture guards, workflows, TypeScript/workspace configurations and browser helpers/tests/configuration are byte-for-byte unchanged from baseline. No affected-path selector exists; full unconditional gates cover both old and new owners. No held-out evaluator files were accessed.
- Live YouTube/provider acceptance retains its original opt-in skip. Prompt AI evaluation is inapplicable because no prompt/schema changed; no provider calls were made. Linux browser execution belongs to current CI, not a substituted local command.
- Committed report text contains no personal executor, credential or study paths. Historical pending claims above are corrected by this appendix; final native commit, PR/head, actual configured assessment, CI, mergeability and cleanliness belong to the external recovery evidence, avoiding a self-referential commit hash or invented result.
- Recovery uses at most two rounds and twenty turns under the original absolute deadline `2026-11-12T10:58:00Z`; no retry renews it. Observable usage and any unavailable startup/compaction accounting are reported in the worker handoff. The architecture assessment target stays 95; a history-limited measured 85, if returned, remains an unmet residual rather than a fabricated improvement.
- Delivery handoff is provisional until the supervisor submits it to the normal final system gate. This report does not claim system acceptance. Auto-merge stays disabled; no merge or retarget is authorized.
