# Tasks: 20260314.01.cli-cloud-auth-pkce

**Created**: 2026-03-14

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Scaffold auth commands and PKCE config

**Status**: ✅ DONE
**Created**: 2026-03-14 07:13
**Completed**: 2026-03-14 07:33

Add `stigmer auth login`, `auth logout`, `auth whoami` commands to the OSS CLI.
Create PKCE-safe auth config (Auth0 domain, client ID, audience — NO client secret).

### Subtasks
- [x] Add `auth` parent command with `login`, `logout`, `whoami` subcommands via Cobra
- [x] Create `internal/cli/auth/config.go` with public-safe Auth0 config (no `ClientSecret`)
- [x] Skipped custom PKCE package — `golang.org/x/oauth2` v0.34.0 has native PKCE support
- [x] `logout` clears `backend.cloud.token` from config
- [x] `whoami` calls WhoAmI RPC using stored token via standalone gRPC connection

### Notes
- Auth0 client ID is safe to embed — it's public for Native/PKCE apps
- Auth0 domain and audience URLs are public metadata, not secrets
- Skipped custom PKCE package: `golang.org/x/oauth2` v0.34.0 provides `GenerateVerifier()`, `S256ChallengeOption()`, `VerifierOption()` natively
- Used flat package structure (`internal/cli/auth/`) instead of nested sub-packages
- Hardcoded Auth0 endpoints instead of OIDC discovery (no `go-oidc` dependency)
- Used `clioutput` structured renderer pattern (OSS convention), not `cliprint` (cloud convention)
- WhoAmI uses standalone temp gRPC connection, independent of backend.Client (which gets auth wiring in Task 3)

### Files Created
- `client-apps/cli/cmd/stigmer/root/auth.go` — Cobra commands
- `client-apps/cli/internal/cli/auth/config.go` — Auth0 PKCE config
- `client-apps/cli/internal/cli/auth/login.go` — Login stub (Task 2)
- `client-apps/cli/internal/cli/auth/whoami.go` — FetchIdentity via WhoAmI RPC

### Files Modified
- `client-apps/cli/cmd/stigmer/root.go` — Registered auth command
- `client-apps/cli/cmd/stigmer/root/backend.go` — Fixed hint: `stigmer login` → `stigmer auth login`

---

## Task 2: Implement PKCE OAuth login flow

**Status**: ✅ DONE
**Created**: 2026-03-14 07:13
**Completed**: 2026-03-14 07:48

Implement the full PKCE authorization code flow: local HTTP callback server,
browser redirect to Auth0, token exchange with code_verifier (no client secret),
and token storage in `backend.cloud.token`.

### Subtasks
- [x] Start local HTTP server on `localhost:8088` for callback
- [x] Build Auth0 authorization URL with `code_challenge`, `code_challenge_method=S256`, `response_type=code`
- [x] Open system browser to Auth0 authorize endpoint
- [x] Handle callback: extract `code` param, validate `state`
- [x] Exchange authorization code + `code_verifier` for access token (POST to token endpoint, no client_secret)
- [x] Store access token in `~/.stigmer/config.yaml` at `backend.cloud.token`
- [x] Serve success/error HTML page to browser after callback
- [x] ~~Handle existing valid token (skip re-login)~~ — Design decision: always re-authenticate (matches gcloud/gh pattern)

### Notes
- Used `golang.org/x/oauth2` native PKCE: `GenerateVerifier()`, `S256ChallengeOption()`, `VerifierOption()`
- No manual token exchange needed — `oauthConfig.Exchange(ctx, code, oauth2.VerifierOption(verifier))` handles PKCE natively
- Auto-sets `backend.type: cloud` on successful login
- Skipped 1.1MB logo.svg from cloud CLI to keep OSS binary lean — pages use animated SVG checkmark/X icons instead
- Design decision: always re-authenticate (no token validation check), matching gcloud/gh auth login behavior

### Improvements Over Cloud CLI
- Go channels instead of temp files for auth code transfer
- State parameter validation (CSRF protection — cloud CLI never validates state)
- Dedicated `http.ServeMux` (not global `http.DefaultServeMux`)
- Graceful HTTP server shutdown after callback
- 5-minute timeout (cloud CLI waits forever)
- No `google/uuid` dependency — `oauth2.GenerateVerifier()` for state too

### Files Created
- `client-apps/cli/internal/cli/auth/browser.go` — Cross-platform browser opener
- `client-apps/cli/internal/cli/auth/callback.go` — HTTP callback server with channel-based result passing
- `client-apps/cli/internal/cli/auth/pages.go` — Success/error HTML templates

### Files Modified
- `client-apps/cli/internal/cli/auth/login.go` — Replaced stub with full PKCE flow
- `client-apps/cli/cmd/stigmer/root/auth.go` — Updated for `(*LoginResult, error)` return type
- `client-apps/cli/go.mod` — `golang.org/x/oauth2` promoted from indirect to direct

### Reference Files
- `stigmer-cloud/client-apps/cli/internal/cli/auth/login/login.go` — full flow to port
- `stigmer-cloud/client-apps/cli/internal/cli/auth/login/logo.svg` — success page branding (skipped — 1.1MB)

---

## Task 3: Wire auth into cloud backend connection

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:13

Implement the `addAuthHeader` interceptor stub in the OSS CLI's backend client.
Support `STIGMER_API_KEY` env var override. Auto-prompt login when cloud backend
is selected but no token is available.

### Subtasks
- [ ] Implement `addAuthHeader()` in `internal/cli/backend/client.go` (currently a TODO stub)
- [ ] Token resolution order: `STIGMER_API_KEY` env var > `--api-key` flag > `backend.cloud.token` from config
- [ ] Add `--api-key` global flag to root command
- [ ] Auto-login: when cloud backend selected but no token, prompt "Authentication not found. Run stigmer auth login"
- [ ] Wire Bearer token into gRPC `PerRPCCredentials`
- [ ] Test: `stigmer config backend set cloud` → `stigmer auth login` → any command works

### Notes
- The OSS CLI's `backend/client.go` already has the cloud connection path, just needs auth wired in
- Match the cloud CLI's `authheader.GetValue()` priority logic
- gRPC credentials: `grpc.WithPerRPCCredentials(tokenAuth{token: t})`

### Reference Files
- `stigmer-cloud/client-apps/cli/internal/cli/backend/authheader/get_value.go` — token resolution
- `stigmer-cloud/client-apps/cli/internal/cli/backend/backend.go` — gRPC auth wiring
- `stigmer/client-apps/cli/internal/cli/backend/client.go` — the stub to implement

---

## Task 4: Delete auth from cloud CLI

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:13

Remove all authentication code from stigmer-cloud CLI. After OSS auth is working
and validated, the cloud CLI should delegate to the OSS CLI for auth or be deprecated.

### Subtasks
- [ ] Remove `stigmer-cloud/client-apps/cli/internal/cli/auth/` directory (contains embedded client secret)
- [ ] Remove `stigmer-cloud/client-apps/cli/cmd/stigmer/auth.go`
- [ ] Remove `stigmer-cloud/client-apps/cli/cmd/stigmer/whoami.go`
- [ ] Update cloud CLI to use OSS CLI's auth module (or deprecate cloud CLI entirely)
- [ ] Verify no dangling imports
- [ ] Confirm the client secret (`haPGCQa...`) is gone from the codebase

### Notes
- This task depends on Tasks 1-3 being complete and validated
- Consider: is the cloud CLI still needed at all, or does the OSS CLI with `backend.type: cloud` replace it?
- The cloud CLI's `backend/authheader/get_value.go` pattern should already be ported by Task 3

---

## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] `stigmer auth login` opens browser, completes PKCE flow, stores token
- [ ] `stigmer auth logout` clears token
- [ ] `stigmer auth whoami` shows logged-in user
- [ ] Cloud backend commands work with stored token
- [ ] `STIGMER_API_KEY` env var override works
- [ ] No client secret anywhere in OSS CLI code
- [ ] Client secret removed from cloud CLI code
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!
