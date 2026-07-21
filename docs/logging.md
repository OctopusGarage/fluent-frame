# FluentFrame Logging

FluentFrame native-host logs are written as JSON lines.

Default location:

```bash
~/.fluent-frame/logs/native-host.log
```

Override for debugging or tests:

```bash
FF_LOG_FILE=/tmp/fluent-frame-native-host.log pnpm run doctor
```

Each line is one structured event:

```json
{"timestamp":"2026-07-21T00:00:00.000Z","level":"info","component":"queue","event":"job.enqueued","message":"Queued","requestId":"queue1","jobId":"dQw4w9WgXcQ:en:2026-07-20-learning-cues-1","videoId":"dQw4w9WgXcQ","details":{"status":"queued","title":"Video title"}}
```

Common fields:

- `timestamp`: ISO timestamp.
- `level`: `debug`, `info`, `warn`, or `error`.
- `component`: native-host area, such as `hostRouter`, `queue`, `queueRunner`, `queueProcessor`, `processor`, or `videoMetadata`.
- Remote cache hits currently appear under `processor` or `queue`, with
  `details.mode` set to `remoteCache` when a GitHub cache hit is returned.
- `event`: stable event name.
- `requestId`: native messaging request ID when available.
- `jobId`: queue job ID when available.
- `videoId`: YouTube video ID when available.
- `details`: event-specific structured data.

Useful checks:

```bash
tail -f ~/.fluent-frame/logs/native-host.log
rg '"level":"error"' ~/.fluent-frame/logs/native-host.log
rg '"videoId":"dQw4w9WgXcQ"' ~/.fluent-frame/logs/native-host.log
rg '"event":"job.failed"' ~/.fluent-frame/logs/native-host.log
rg '"event":"title.failed"' ~/.fluent-frame/logs/native-host.log
```

Rotation:

- `native-host.log` rotates to `native-host.log.1` when it reaches 5 MB.
- Logging failures never break native messaging or queue processing.
