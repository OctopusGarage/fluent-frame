# Local Development Installation

FluentFrame is distributed as a Chrome development-mode extension plus a local
native host. This avoids Chrome Web Store fees while keeping setup predictable.

## Quick Start

For the shortest Chrome-focused install checklist, see
[docs/local-chrome-install.md](local-chrome-install.md).

```bash
git clone git@github.com:OctopusGarage/fluent-frame.git
cd fluent-frame
pnpm local:install
```

`pnpm setup` remains available as an alias.

The setup wizard:

1. Detects `yt-dlp`, Codex, and Claude.
2. Lets you choose Codex or Claude as the local agent.
3. Writes `~/.fluent-frame/config.json`.
4. Installs dependencies and builds the workspace.
5. Registers the Chrome native messaging host.
6. Opens `chrome://extensions`.
7. Guides you through loading `apps/extension/dist`.
8. Links the Chrome extension ID if you paste it into the wizard.

Chrome still requires the `Load unpacked` click manually. FluentFrame automates
the rest.

## Daily Update

After FluentFrame is installed as an unpacked development-mode extension, use one
command for normal updates:

```bash
pnpm local:update
```

The update command:

1. Pulls the latest source with `git pull --ff-only`.
2. Installs dependencies with `pnpm install --frozen-lockfile`.
3. Builds the Chrome extension and native host.
4. Refreshes the native-host wrapper and manifest using the saved
   `~/.fluent-frame/config.json`.
5. Runs `pnpm run doctor`.
6. Opens `chrome://extensions`.

Chrome does not provide a reliable no-permission way for this project to reload
an unpacked extension from a local script. After `pnpm local:update` finishes,
click Reload on FluentFrame in `chrome://extensions`.

For local-only worktrees where you do not want to pull from GitHub:

```bash
pnpm local:update --no-pull
```

## Commands

```bash
pnpm local:install
```

Run the guided local installer.

```bash
pnpm local:update
```

Update local source, rebuild, refresh the native host, run diagnostics, and open
Chrome's extension management page.

```bash
pnpm local:open
```

Open `chrome://extensions` and print the unpacked extension path.

```bash
pnpm setup
```

Alias for `pnpm local:install`.

```bash
pnpm link:chrome <extension-id>
```

Register the unpacked Chrome extension ID with the native host. Use this if you
skipped the ID prompt during setup or reloaded the extension and got a new ID.

```bash
pnpm run doctor
```

Check the local build, native-host manifest, linked Chrome origin, `yt-dlp`,
selected local agent, and optional GitHub remote cache config.

`pnpm doctor` is a pnpm built-in command, so use `pnpm run doctor` or the alias
`pnpm ff:doctor` for the FluentFrame check.

```bash
pnpm uninstall:local
```

Remove the native-host manifest and wrapper. User cache and notes under
`~/.fluent-frame` are kept.

## Local Config

The setup wizard writes:

```text
~/.fluent-frame/config.json
```

Example:

```json
{
  "agent": "codex",
  "ytDlpPath": "/opt/homebrew/bin/yt-dlp",
  "codexPath": "/opt/homebrew/bin/codex",
  "claudePath": "/opt/homebrew/bin/claude"
}
```

Environment variables still override this file:

```bash
FF_AGENT=claude FF_CLAUDE_PATH=/absolute/path/to/claude pnpm setup
```

## Optional GitHub Remote Cache

FluentFrame can read generated learning subtitle data from a user-owned GitHub
repository before running Codex or Claude. This is useful when you reinstall,
use multiple machines, or enqueue videos that were already generated elsewhere.

Add a generic remote cache block to `~/.fluent-frame/config.json`:

```json
{
  "agent": "codex",
  "remoteCache": {
    "enabled": true,
    "provider": "github",
    "owner": "your-github-name",
    "repo": "your-fluent-frame-cache",
    "branch": "main",
    "basePath": "data/youtube",
    "writeEnabled": false,
    "tokenEnv": "FLUENT_FRAME_GITHUB_TOKEN"
  }
}
```

Remote cache lookup order:

```text
local cache -> GitHub cache -> local Codex/Claude generation
```

Remote paths use:

```text
data/youtube/<videoId>/<captionLanguage>/<workflowVersion>/result.json
```

Public read-only repositories do not require a token. Private repositories and
uploads need a GitHub token in the configured environment variable:

```bash
export FLUENT_FRAME_GITHUB_TOKEN=github_pat_xxx
pnpm run doctor
```

When Chrome launches the native host from the macOS GUI, it may not inherit
variables from your terminal shell. For private repositories or uploads, expose
the token to GUI-launched Chrome before opening Chrome:

```bash
launchctl setenv FLUENT_FRAME_GITHUB_TOKEN github_pat_xxx
```

`writeEnabled` is intentionally `false` by default. Turn it on only when you
want FluentFrame to upload generated cache artifacts to your configured repo.
The token value is never written to `~/.fluent-frame/config.json`.

## Chrome Popup Status

The extension popup can add videos to the local generation queue and runs a
native-host health check. It shows:

- current queue counts
- the active generation job, when one is running
- native host connection
- selected agent
- `yt-dlp` availability
- concrete setup commands when anything is missing

Queue jobs are stored at:

```text
~/.fluent-frame/queue/jobs.json
```

Adding the same video more than once is safe. FluentFrame returns the existing
state instead of creating duplicate local-agent jobs.

On YouTube watch pages, you can right-click a recommended video link and choose
`Add video to FluentFrame queue`. You can also right-click the current watch page
or video area and choose `Add current video to FluentFrame queue`.

If the popup says the native host is not connected, run:

```bash
pnpm run doctor
pnpm link:chrome <extension-id>
```

For debugging, inspect the native-host log:

```bash
tail -f ~/.fluent-frame/logs/native-host.log
```

See [logging.md](logging.md) for structured fields and search examples.

## Native Messaging Boundary

Chrome cannot run local shell commands directly. It can only start the registered
native host:

```text
com.octopusgarage.fluent_frame
```

The manifest is written to:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json
```

The manifest must contain the exact unpacked extension ID:

```json
{
  "allowed_origins": ["chrome-extension://<extension-id>/"]
}
```

`pnpm link:chrome <extension-id>` owns that registration step.
