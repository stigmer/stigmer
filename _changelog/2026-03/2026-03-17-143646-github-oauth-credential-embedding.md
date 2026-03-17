# GitHub OAuth App Registration and Credential Embedding

**Date**: March 17, 2026

## Summary

Registered the "Stigmer Local" and "Stigmer Cloud" GitHub OAuth Apps, and implemented compile-time credential embedding for the OSS CLI binary using Go ldflags. This enables the GitHub workspace repo picker to work out-of-the-box for OSS users without requiring them to register their own GitHub App.

## Problem Statement

The Phase 1 GitHub OAuth workspace integration (session 10) was code-complete, but the OAuth flow required a registered GitHub OAuth App with `client_id` and `client_secret` to function. Without credentials, the backend returned `FAILED_PRECONDITION` and the "Connect GitHub" button could not initiate the flow.

### Pain Points

- OSS users would need to register their own GitHub OAuth App just to use the workspace picker
- Credentials needed a distribution strategy for the open-source binary
- Cloud deployment needed proper secret management via Planton service-hub

## Solution

Adopted the same approach as GitHub CLI (`gh`): embed the `client_id` and `client_secret` as compiled defaults in the Go binary via `-ldflags -X`, with environment variable overrides for enterprise/self-hosted users. For the cloud deployment, used the existing Planton variables-group/secrets-group pattern.

## Implementation Details

### OSS Binary (stigmer repo)

- **`config.go`**: Added `defaultGitHubOAuthClientID` and `defaultGitHubOAuthClientSecret` package-level variables. `LoadConfig()` uses these as fallback defaults when env vars are not set.
- **`Makefile`**: Extended `DEV_LDFLAGS` with conditional GitHub OAuth credential injection when `STIGMER_GITHUB_CLIENT_ID`/`STIGMER_GITHUB_CLIENT_SECRET` are set in the environment.
- **`release.cli.yaml`**: All three CI build jobs (darwin-arm64, darwin-amd64, linux-amd64) now inject credentials from GitHub Actions secrets via ldflags.
- **GitHub Actions secrets**: Created `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_ID` and `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_SECRET` in the stigmer/stigmer repo.

### Cloud Deployment (stigmer-cloud repo)

- **Variables group**: `github-oauth-config.yaml` with `prod.client-id` for the Stigmer Cloud OAuth App
- **Secrets group**: `github-oauth-credentials.yaml` with `prod.client-secret`
- **Service config**: `GITHUB_OAUTH_CLIENT_ID` (variable ref) and `GITHUB_OAUTH_CLIENT_SECRET` (secret ref) added to base and prod overlay service.yaml

### OAuth Apps Registered

| App | Callback URL | Purpose |
|-----|-------------|---------|
| Stigmer Local | `http://localhost:3000/auth/github/callback` | OSS/local development |
| Stigmer Cloud | Cloud domain callback | Production deployment |

## Benefits

- OSS users get GitHub workspace integration out-of-the-box with zero configuration
- Enterprise users can override with their own GitHub App via environment variables
- Security: localhost-only OAuth App client_secret in a public binary is an accepted industry pattern (same as `gh` CLI)
- Cloud deployment uses proper secret management through Planton service-hub

## Impact

- **OSS users**: GitHub workspace picker works immediately after install
- **Cloud deployment**: Credentials managed through existing Planton variables/secrets infrastructure
- **CI/CD**: Release builds automatically embed credentials from GitHub Actions secrets

## Related Work

- Session 10: GitHub OAuth workspace integration (code implementation)
- `tasks/T01_github_app_registration.md`: Original task tracking this work

---

**Status**: Production Ready
**Timeline**: Single session
