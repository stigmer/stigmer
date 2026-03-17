# Done: GitHub OAuth App Registration

**Status:** Complete (Local App registered + credential embedding implemented)
**Blocks:** End-to-end testing of the GitHub workspace integration (Phase 1)

## What was done

### 1. "Stigmer Local" OAuth App — Registered

- **GitHub OAuth App name:** `Stigmer Local`
- **Homepage URL:** `https://stigmer.ai`
- **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
- **Scopes (requested at flow time):** `repo`, `read:user`
- **Device Flow:** Disabled (not needed; web application flow only)
- **Client ID:** `Ov23li4q5kgj90QMr226`

### 2. Credential embedding in binary (Option 1 — like `gh` CLI)

**Decision:** Embed both `client_id` and `client_secret` as compiled defaults in
the Go binary via `-ldflags -X`, with env var overrides for enterprise/self-hosted
users. This is the same pattern used by GitHub CLI (`gh`).

**Security rationale:** The `client_secret` for a localhost-only OAuth App has
limited attack surface — tokens can only be delivered to `localhost`. This is an
accepted industry pattern for developer tools. Any user can extract it from the
binary regardless, so it is not treated as a secret.

**Implementation:**

- **`config.go`:** Added `defaultGitHubOAuthClientID` and `defaultGitHubOAuthClientSecret`
  package-level vars (empty by default, injected via ldflags at build time).
  `LoadConfig()` uses these as fallback defaults; env vars always take precedence.

- **`Makefile`:** `DEV_LDFLAGS` conditionally includes GitHub OAuth credentials
  when `STIGMER_GITHUB_CLIENT_ID` / `STIGMER_GITHUB_CLIENT_SECRET` are set in
  the environment.

- **`release.cli.yaml`:** All three CI build jobs (darwin-arm64, darwin-amd64,
  linux-amd64) inject credentials from GitHub Actions secrets via ldflags.

- **GitHub Actions secrets:** `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_ID` and
  `STIGMER_LOCAL_GITHUB_OAUTH_CLIENT_SECRET` created in `stigmer/stigmer` repo.

### 3. "Stigmer Cloud" OAuth App — Pending

- Needs to be registered when cloud domain is finalized.
- Java backend already reads from `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`
  env vars via Spring `application.yaml` — no code changes needed.
- Credentials will be configured as deployment secrets.

## Where credentials are consumed

- **Go backend:** `backend/services/stigmer-server/pkg/config/config.go`
  - `STIGMER_GITHUB_CLIENT_ID` → `Config.GitHubOAuthClientID` (fallback: ldflags default)
  - `STIGMER_GITHUB_CLIENT_SECRET` → `Config.GitHubOAuthClientSecret` (fallback: ldflags default)

- **Java backend:** `stigmer-cloud/.../application.yaml`
  - `GITHUB_OAUTH_CLIENT_ID` → `github.oauth.client-id`
  - `GITHUB_OAUTH_CLIENT_SECRET` → `github.oauth.client-secret`

## Checklist

- [x] Register "Stigmer Local" OAuth App in GitHub org (localhost callback)
- [ ] Register "Stigmer Cloud" OAuth App in GitHub org (cloud callback)
- [x] Add compiled defaults to `config.go` for local mode (ldflags pattern)
- [x] Update Makefile for local dev builds with optional credential injection
- [x] Update CI workflow to inject credentials from secrets
- [x] Add GitHub Actions secrets for Local App credentials
- [ ] Set credentials in cloud deployment secrets
- [ ] Verify end-to-end OAuth flow with embedded credentials
