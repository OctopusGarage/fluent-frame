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

## Verify Queue

1. Open the FluentFrame popup on a YouTube watch page.
2. Click `Add current video to queue`.
3. Confirm the popup shows `Queued`, `Already generating`, or `Already ready`.
4. Paste a YouTube watch URL or `youtu.be` URL into the popup queue form.
5. Confirm the queue summary updates.
6. Click `Add to queue` in the in-video FluentFrame panel.
7. Right-click a right-hand recommended video link and choose `Add video to FluentFrame queue`.
8. Confirm the current video does not navigate away and the queue summary shows the new job state.
9. Confirm repeated clicks do not create duplicate jobs.
10. Inspect `~/.fluent-frame/queue/jobs.json` and confirm the job status moves through `queued`, `running`, and then `done` or `failed`.
11. Open a queued video after generation completes and confirm learning subtitles load from cache without waiting for a full generation run.

## Error Checks

- Chrome launches the native host from the installed manifest, so shell variables set in a normal terminal will not affect an already-running Chrome instance. To verify missing-binary errors, temporarily edit `~/.fluent-frame/bin/native-host` and set `export FF_YTDLP_PATH=/missing/yt-dlp` before the `node` command, then restore the wrapper after the check.
- Repeat the wrapper edit with `export FF_CODEX_PATH=/missing/codex` or `export FF_CLAUDE_PATH=/missing/claude` and confirm the extension reports that the selected agent is missing, then restore the wrapper.
- Open another YouTube video in the same tab and confirm the UI resets to `Ready`.
- Toggle the overlay and confirm the side panel remains visible.
- Retry a failed queue job from the popup and confirm it returns to `queued`.
