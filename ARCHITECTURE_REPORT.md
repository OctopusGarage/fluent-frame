# Native queue ownership repository

## Authorized slice and pre-mutation review

One structural change: extract durable queue transactions and owned-running updates
from `apps/native-host/src/queueStore.ts` into `queueRepository.ts`.
The repository module hides file locking, parsing, atomic persistence, and claim
fencing behind a small interface. QueueStore remains the legacy adapter and owns
queue domain transitions. Depth improves locality: four ownership checks and
write decisions become one implementation. The deletion test would spread these
invariants back across heartbeat, progress, completion, and failure callers.
No hypothetical storage adapter, scheduler redesign, or new admission policy.

Before: QueueStore -> repeated lock/read/check/write for each running update.
After: QueueStore -> repository.updateRunning -> locked ownership check + write.
Other queue transitions use synchronous repository transactions; slow generation,
title/cache resolution, subprocess startup, and logging remain outside the lock.

## Acceptance, risk, and verification plan (recorded before edits)

- Preserve public QueueStore and QueueWorkStore methods and persisted JSON shape.
- Match both running status and claim ID after acquiring the file lock.
- Stale/missing heartbeat and progress return undefined without writing; missing
  completion/failure still throw `Queue job not found`.
- Preserve terminal claim cleanup, progress, timestamps, serial claiming, stale
  recovery, corrupt-file backup, and propagation of persistence failures.
- Regression contracts exercise real disk state through the repository interface
  and legacy adapter, including lock contention and stale recovery/reclaim.
- Main risks: moving I/O could change no-write behavior, error propagation, or
  lock release. Existing runner persistence and queue suites remain authoritative.
- Unchanged required gates: offline frozen install, explicit `pnpm run typecheck`,
  `pnpm test`, `pnpm verify:local` (lint/typecheck/coverage/build/audit), browser
  E2E, and Linux/macOS CI checks plus CI aggregate verify. All long commands use
  explicit Node child-process timeouts. Live agent/prompt eval is inapplicable:
  no prompt/schema changes and no live model calls are authorized.
- Native evaluator-style advisory review will investigate behavior, seams,
  regressions, overengineering, security, scheduler/state, and durable data risks.
- Bounded architecture assessment target: 95; at most two focused rounds.

## Initial evidence

- Exact isolated root and required branch verified; initial worktree clean.
- `.codegraph/` absent; CodeGraph skipped as instructed.
- Read README, CONTRIBUTING, workspace/package manifests, CONTEXT, architecture
  ADR and docs, queue source/tests, architecture guards, and CI workflows.
- Preflight passed: lockfile exists, pnpm resolves, frozen offline install exits
  0 (152 packages), and node_modules exists. No architecture edits preceded it.

## Implementation and post-mutation review

One structural extraction completed. `queueRepository.ts` owns file locking,
parsing/corrupt-file backup, normalized atomic writes, and `updateRunning`.
The repository interface is `read`, `transact`, and `updateRunning`. Synchronous
transition callbacks are an internal seam for queue domain decisions, not an
extension point for network or generation work. QueueStore is the legacy adapter;
runner, processor, coordinator, and runtime composition remain unchanged.

Native review found no blocking queue implementation findings. It identified an
initial ordering-test weakness, which was corrected: an old worker waits behind
a real file lock while the lock holder replaces the durable claim. The waiting
transition must not run or write after the lock is released. A mutation experiment
moved snapshot reading before the lock: exactly this contract failed (1 failed,
4 passed). The correct implementation was restored. Existing real-filesystem
runner contracts exercise persistence errors and recovery through the same seam.

## Baseline advisories and minimal compatible repair

The unchanged `pnpm verify:local` initially passed lint, typecheck, coverage, and
build, then exited 1 at its `pnpm audit` invocation:
`7 vulnerabilities found; Severity: 1 low | 5 moderate | 1 high`.

- Vite 7.3.6 -> 7.3.7 fixes GHSA-698v-4r3x-3vcv,
  GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm (high),
  GHSA-9jrq-w75r-8gcw, and GHSA-rq7h-c2jc-7f22.
- Vitest and matching coverage 4.1.11 -> 4.1.12 bring the matching mocker patch
  for GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp.
- The gate invokes pnpm's audit command without a severity filter, so all seven
  advisories block it. No gate scripts, workflows, thresholds, or guard tests
  were changed. Unrelated Babel, esbuild, rollup, and utility refreshes from
  initial resolution were removed from the lockfile. Package integrity was
  checked against registry metadata. Final frozen online install, frozen offline
  install, and `pnpm audit` passed (`No known vulnerabilities found`).
- Dependency-repair attempts briefly produced an outdated lockfile and then a
  lockfile integrity mismatch while trimming incidental transitive updates.
  Both were corrected before final frozen installs and gate execution.

## Verification evidence and failure diagnosis

Long pnpm checks use Node `execFileSync` with explicit `timeout` (120000 ms for
focused tests/audit, 180000 ms install/typecheck, 300000 ms browser E2E,
600000 ms full test/local gate). No GNU timeout dependency.

- Initial repository test run failed because the new module did not exist yet.
  A focused invocation then required building the shared workspace package;
  `pnpm run typecheck` supplied that prerequisite and passed.
- Focused queue repository/store/runner-persistence checks: 3 files, 32 tests
  passed. The repository suite contains five ownership contract cases.
- Initial full `pnpm test`: shared 42, extension 182, native host 170, and
  script tests 74 passed. Coverage gate: 3099/3758 executable lines (82.46%),
  above the unchanged 80% threshold, including the new repository module.
- Browser E2E initially timed out twice at the unchanged 45000 ms test limit.
  Trace inspection showed all application assertions reached the final URL
  assertion; discovery-context shutdown consumed about 25-30 seconds before
  the actual test context launched. A standalone diagnostic reproduced slow
  Chromium shutdown (17.542 seconds); disabling background mode did not resolve
  it (18.505 seconds). No test timeout, assertion, launch option, or gate was
  changed. A final unchanged run with browser debug logging records the outcome
  below. Live-provider E2E remains opt-in and is skipped by the existing test.
- Initial architecture assessment returned `score: null` with an explicit dirty
  worktree skip. The prescribed assessment will be rerun after committing the
  verified worktree; its output and CI results belong in the delivery handoff.

## Native evaluator-style advisory evidence

```json
[
  {
    "questionInvestigated": "Does the repository own locked stale-run fencing and persistence?",
    "conclusion": "Yes; lookup, running-status and claim-ID checks, transition, and atomic persistence share one locked transaction.",
    "evidence": [
      "apps/native-host/src/queueRepository.ts: transact reads state inside withLock; updateRunning omits jobs when ownership is lost.",
      "apps/native-host/src/queueStore.ts: all four running updates delegate to updateRunning.",
      "apps/native-host/tests/queueRepository.test.ts: lock-holder claim replacement and byte-preserving stale updates; pre-lock snapshot mutation was rejected."
    ],
    "uncertainty": "The 30 ms test scheduling window may reduce mutation sensitivity under extreme load.",
    "recommendedNextStep": "Accept the bounded seam; preserve the ordering contract."
  },
  {
    "questionInvestigated": "Are legacy entry points, behavior, and regressions preserved?",
    "conclusion": "QueueStore signatures and the missing-job distinction remain unchanged; progress, heartbeat, completion/failure timestamps and terminal claim cleanup are covered.",
    "evidence": [
      "apps/native-host/tests/queueRepository.test.ts: four parameterized legacy mutations across stale recovery/reclaim and missing jobs.",
      "apps/native-host/tests/queueStore.test.ts: serial claims, heartbeat recovery, corrupt/unreadable files, retry/remove.",
      "apps/native-host/tests/queueRunnerPersistence.test.ts: durable failure propagation and subsequent recovery."
    ],
    "uncertainty": "Native review is advisory; local and CI gate outputs determine acceptance.",
    "recommendedNextStep": "Require unchanged deterministic checks and record every failure."
  },
  {
    "questionInvestigated": "Does the seam provide depth and locality without overengineering?",
    "conclusion": "One file-backed adapter concentrates ownership and persistence knowledge behind three operations; deleting it would spread those invariants back across the legacy adapter.",
    "evidence": [
      "apps/native-host/src/queueRepository.ts: read/transact/updateRunning interface.",
      "apps/native-host/src/queueStore.ts: filesystem details and four repeated fences removed.",
      "apps/native-host/src/queueRuntime.ts: composition unchanged."
    ],
    "uncertainty": "General synchronous transactions remain an internal seam for domain transitions.",
    "recommendedNextStep": "Do not introduce speculative storage adapters or a second scheduler abstraction."
  },
  {
    "questionInvestigated": "Are security, scheduler/state, or durable-data risks introduced?",
    "conclusion": "No new external effects or credential handling; slow title/cache resolution, subprocess startup, and generation remain outside file locks.",
    "evidence": [
      "apps/native-host/src/queueRepository.ts: existing lock retry/stale-lock and corrupt-file behavior retained; writeJsonFileAtomically remains the write adapter.",
      "apps/native-host/src/queueCoordinator.ts and queueRunner.ts: scheduling and expensive work unchanged.",
      "package.json, apps/extension/package.json, pnpm-lock.yaml: only audit-required compatible package patches retained."
    ],
    "uncertainty": "Pre-existing age-based stale-lock reclamation and unlocked corrupt-file recovery are not redesigned or newly proven safe.",
    "recommendedNextStep": "Accept unchanged risks for this slice and defer lock-protocol redesign."
  }
]
```

## Remaining risks and deferred ideas

Age-based stale-lock reclamation and unlocked corrupt-file recovery remain
pre-existing limitations. This change fences queue state, not writes to generated
subtitle caches by a worker that has already lost ownership. Cancellation and
cache publication fencing are deferred. No second structural change is needed.

## Final local gate result before commit

With the minimized lockfile and restored implementation:

| Command | Outcome | Bounded evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | exit 0 |
| `pnpm install --frozen-lockfile --offline` | PASS | exit 0 |
| `pnpm run typecheck` | PASS | all three workspaces exit 0 |
| `pnpm test` | PASS | 394 workspace tests and 74 script tests |
| `pnpm verify:local` | PASS | lint, typecheck, coverage, build, audit all exit 0 |
| `pnpm audit` | PASS | No known vulnerabilities found |
| `gitleaks dir . --config .gitleaks.toml --redact` | PASS | exit 0 |
| `pnpm e2e` | FAIL | 1 failed, 1 existing opt-in skip; 45000 ms shutdown timeout |

The third browser attempt retained the same failure. Browser debug logging shows
first-context graceful shutdown taking 16 seconds, then final-context shutdown
remaining in progress until the test timed out and Playwright killed Chromium.
This is an explicit unresolved local acceptance limitation. The test and workflow
are unchanged; Linux browser CI must be observed separately. No broad browser
or scheduler repair is included in this queue ownership slice.

Delivery status, exact commit, clean-tree assessment score, PR metadata and final
remote check results are reported in the handoff and authored PR body. No merge
or retarget is authorized. A second focused round is only warranted for a
confirmed remaining defect; a score limited by evaluator history is not a reason
to widen the implementation.
