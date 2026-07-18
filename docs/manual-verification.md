# Manual Verification

## Build

```bash
pnpm install
pnpm verify:local
pnpm e2e
```

## Install Extension

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select `apps/extension/dist`.
5. Copy the extension ID.

## Install Native Host

1. Run `pnpm --filter @fluent-frame/native-host build`.
2. Run `FF_EXTENSION_ID=<copied-extension-id> pnpm --filter @fluent-frame/native-host install:native-host`.
3. Confirm the generated wrapper at `~/.fluent-frame/bin/native-host` includes absolute `FF_YTDLP_PATH`, `FF_CODEX_PATH`, and/or `FF_CLAUDE_PATH` exports. If a tool was not found, rerun setup with an explicit path, such as `FF_YTDLP_PATH=/absolute/path/to/yt-dlp FF_CODEX_PATH=/absolute/path/to/codex pnpm setup`.
4. If you omit `FF_EXTENSION_ID` on a later rerun, the installer preserves an existing non-placeholder `allowed_origins` value.
5. If the local manifest still contains the placeholder origin, rerun the installer with `FF_EXTENSION_ID=<copied-extension-id>`.
6. For a first install without `FF_EXTENSION_ID`, edit `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.octopusgarage.fluent_frame.json` and replace `EXTENSION_ID_FROM_CHROME` with the copied extension ID.

## Verify

1. Open a YouTube video with English captions.
2. Click `Generate learning subtitles`.
3. Confirm the overlay appears over the video.
4. Confirm the side panel shows phrase explanations.
5. Reload the page and generate again.
6. Confirm the cached result loads faster than the first run.

## Error Checks

- Chrome launches the native host from the installed manifest, so shell variables set in a normal terminal will not affect an already-running Chrome instance. To verify missing-binary errors, temporarily edit `~/.fluent-frame/bin/native-host` and set `export FF_YTDLP_PATH=/missing/yt-dlp` before the `node` command, then restore the wrapper after the check.
- Repeat the wrapper edit with `export FF_CODEX_PATH=/missing/codex` or `export FF_CLAUDE_PATH=/missing/claude` and confirm the extension reports that the selected agent is missing, then restore the wrapper.
- Open another YouTube video in the same tab and confirm the UI resets to `Ready`.
- Toggle the overlay and confirm the side panel remains visible.
