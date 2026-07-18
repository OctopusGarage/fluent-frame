# Security Policy

## Reporting A Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Use GitHub Private Vulnerability Reporting:

https://github.com/OctopusGarage/fluent-frame/security/advisories/new

We will acknowledge reports within 7 days.

## Security Model

FluentFrame is local-first. The Chrome extension cannot run shell commands directly.
It can only send typed JSON requests to the registered native host:

```text
com.octopusgarage.fluent_frame
```

Chrome starts that host only when the native messaging manifest allows the exact
extension ID in `allowed_origins`.

Important properties:

- No hosted LLM API key is required.
- The native host accepts only a small typed request protocol.
- The native host stores data under `~/.fluent-frame`.
- Local commands are limited to the configured `yt-dlp` and agent CLI paths.
- Personal notes and cached subtitle results stay on the local machine.

## Sensitive Data

Never commit:

- Chrome extension IDs tied to private builds unless intentionally documented.
- local usernames or absolute personal paths in source or docs.
- tokens, cookies, API keys, browser profiles, or downloaded private media.
- generated cache data from `~/.fluent-frame`.

Run before pushing:

```bash
pnpm verify:local
```

The repository also runs Gitleaks in GitHub Actions.
