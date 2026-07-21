# GitHub Remote Cache Design

FluentFrame should optionally use a user-owned GitHub repository as a remote
cache for generated learning subtitle data. The local cache remains the primary
runtime cache; GitHub is a reusable sharing and backup layer that prevents
repeat generation across machines or fresh installs.

## Goals

- Fetch existing generated learning subtitle data from a configured GitHub repo
  before running Codex or Claude.
- Upload newly generated or partial-ready learning subtitle data after local
  generation succeeds.
- Keep repository configuration generic so every user can bring their own owner,
  repo, branch, and base path.
- Avoid storing tokens directly in `~/.fluent-frame/config.json`.
- Keep queue state local. Only stable generated artifacts are remote cached.

## Lookup Flow

```text
processVideo(videoId, language)
  -> local cache hit? return
  -> GitHub remote cache enabled? try download result.json
  -> remote hit? validate, write local cache, return
  -> download YouTube captions
  -> run local agent
  -> write local cache for generated or partial-ready result
  -> GitHub upload enabled? upload result.json
  -> return result
```

Queue jobs use the same cache path. Enqueue checks local cache first, then the
remote cache, and marks the job ready when either already contains a valid
result.

## GitHub Layout

Remote paths are deterministic and match FluentFrame's cache identity:

```text
<basePath>/<videoId>/<captionLanguage>/<workflowVersion>/result.json
```

Example:

```text
data/youtube/o3RPPjzciqo/en/2026-07-20-learning-cues-1/result.json
```

## Config

```json
{
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

`writeEnabled` defaults to `false`. Reading public repositories works without a
token. Private repository reads and all writes require a token exposed through
the configured environment variable.

## Error Policy

Remote cache failures must not block local generation. Network errors, auth
errors, invalid JSON, and invalid result schemas are logged and treated as a
remote miss. Upload failures are also logged without failing the user-visible
generation result.

## First Implementation Scope

- Native-host GitHub Contents API provider.
- Config parsing and env propagation to detached queue workers.
- Remote cache lookup before generation.
- Remote upload after generated or partial-ready output.
- Queue `cacheReady` check includes remote cache.
- Health output reports remote cache configuration and token presence.
- Unit tests for provider, config, processor, queue request handling, and health.

## Reference

- GitHub REST API repository contents endpoints:
  https://docs.github.com/en/rest/repos/contents
