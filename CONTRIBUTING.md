# Contributing

FluentFrame is a pnpm TypeScript monorepo:

```text
apps/extension     Chrome extension UI and background bridge
apps/native-host   local native messaging host and caption/agent pipeline
packages/shared    protocol types, validators, and subtitle parsing
e2e                Playwright extension tests
```

## Setup

```bash
pnpm install
pnpm build
```

Load `apps/extension/dist` from `chrome://extensions`, then install the native host:

```bash
FF_EXTENSION_ID=<copied-extension-id> pnpm --filter @fluent-frame/native-host install:native-host
```

## Local Quality Gate

Run the local gate before pushing:

```bash
pnpm verify:local
```

That runs:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit`

For browser UI/native-messaging changes, also run:

```bash
pnpm e2e
```

For prompt/schema quality changes, also run:

```bash
pnpm eval:ai
```

## Development Rules

- Keep native-host requests narrow and typed in `packages/shared`.
- Preserve original SRT timing; agent output must not drive subtitle timing.
- Keep Chrome UI behavior covered in `apps/extension/tests`.
- Keep native-host filesystem and process behavior covered in `apps/native-host/tests`.
- Do not commit `.superpowers`, `docs/superpowers`, `test-results`, local cache, or browser profile data.

## Commit Style

Use conventional commit prefixes when practical:

```text
feat:
fix:
test:
docs:
chore:
refactor:
```

## Pull Request Automation

Dependency updates and bot-managed PRs target `dev`; `main` is promoted
manually. See [docs/pr-automation.md](docs/pr-automation.md) for the automatic
merge gates and the tmux-claude-bot review policy.
