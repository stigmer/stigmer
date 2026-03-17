# Hardcode GitHub OAuth Credentials in Source Code

**Date**: March 17, 2026

## Summary

Changed the GitHub OAuth credential distribution strategy from build-time ldflags injection to source-level defaults, matching the actual `gh` CLI pattern. The "Stigmer Local" OAuth App's `client_id` and `client_secret` are now hardcoded in `config.go`, eliminating the need for environment variables or ldflags during local development builds.

## Problem Statement

The previous implementation stored empty defaults in `config.go` and relied on two injection paths:
- **CI builds**: ldflags injection from GitHub Actions secrets (working)
- **Local builds**: `make local` with `STIGMER_GITHUB_CLIENT_ID` / `STIGMER_GITHUB_CLIENT_SECRET` env vars set (broken in practice)

### Pain Points

- `make local` produced a binary with no GitHub OAuth credentials unless the developer manually exported env vars
- GitHub Actions secrets are write-only — they cannot be read back via API or `gh` CLI, so there was no way to automate fetching them for local builds
- Clicking "Connect GitHub account" in the web console threw `FailedPrecondition: GitHub OAuth is not configured (STIGMER_GITHUB_CLIENT_ID not set)`
- The changelog described the pattern as "same as GitHub CLI (`gh`)" but `gh` CLI actually hardcodes its credentials in source, not via ldflags

## Solution

Hardcoded the "Stigmer Local" OAuth App credentials directly in `config.go` as the source-level default values. This follows the actual `gh` CLI pattern where localhost-only OAuth App credentials are committed to source.

## Implementation Details

### `config.go` — Source-level defaults

Changed the empty default variables to contain the actual credentials:

```go
var (
	defaultGitHubOAuthClientID     = "Ov23li4q5kgj90QMr226"
	defaultGitHubOAuthClientSecret = "edc089d10b6cc0dcee898f9680d62d1504e2c89a"
)
```

The existing `getEnvString()` calls on lines 70-71 still allow env var overrides (`STIGMER_GITHUB_CLIENT_ID` / `STIGMER_GITHUB_CLIENT_SECRET`) for enterprise/self-hosted users. CI release builds can still override via ldflags for the Cloud OAuth App.

### `Makefile` — Simplified DEV_LDFLAGS

Removed the conditional `ifdef STIGMER_GITHUB_CLIENT_ID` / `ifdef STIGMER_GITHUB_CLIENT_SECRET` block from `DEV_LDFLAGS`. These are no longer needed since the source defaults handle the Local app credentials.

The CI release workflow (`release.cli.yaml`) retains its ldflags — those serve the Cloud OAuth App which uses different credentials.

## Benefits

- Zero-config local development: `make local` and `stigmer server` work with GitHub OAuth out of the box
- No dependency on manually exporting env vars for local builds
- Truly matches the `gh` CLI pattern (credentials in source, not build-time injection)
- Enterprise override path preserved via env vars

## Impact

- **Local development**: GitHub "Connect" flow works immediately after `make local` with no extra setup
- **CI/CD**: No change — release builds continue using ldflags from GitHub Actions secrets
- **Enterprise/self-hosted**: No change — env var overrides still take precedence

## Related Work

- Previous changelog: `2026-03-17-143646-github-oauth-credential-embedding.md` (original ldflags-based approach)
- `2026-03-17-141340-github-oauth-workspace-integration.md` (the OAuth flow implementation)

---

**Status**: Production Ready
**Timeline**: Single session
