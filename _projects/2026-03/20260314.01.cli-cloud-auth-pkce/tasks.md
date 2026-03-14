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

**Status**: ⏸️ TODO
**Created**: 2026-03-14 07:13

Implement the full PKCE authorization code flow: local HTTP callback server,
browser redirect to Auth0, token exchange with code_verifier (no client secret),
and token storage in `backend.cloud.token`.

### Subtasks
- [ ] Start local HTTP server on `localhost:8088` for callback
- [ ] Build Auth0 authorization URL with `code_challenge`, `code_challenge_method=S256`, `response_type=code`
- [ ] Open system browser to Auth0 authorize endpoint
- [ ] Handle callback: extract `code` param, validate `state`
- [ ] Exchange authorization code + `code_verifier` for access token (POST to token endpoint, no client_secret)
- [ ] Store access token in `~/.stigmer/config.yaml` at `backend.cloud.token`
- [ ] Serve success/error HTML page to browser after callback
- [ ] Handle existing valid token (skip re-login)

### Notes
- Port `login.go` from cloud CLI but replace `oauthConfig.Exchange()` with manual PKCE token exchange
- Auth0 PKCE token exchange POST body: `grant_type=authorization_code`, `client_id`, `code_verifier`, `code`, `redirect_uri`
- No `client_secret` in the exchange — this is the whole point of PKCE
- Consider: should `auth login` automatically set `backend.type: cloud`? Probably yes.

### Reference Files
- `stigmer-cloud/client-apps/cli/internal/cli/auth/login/login.go` — full flow to port
- `stigmer-cloud/client-apps/cli/internal/cli/auth/login/logo.svg` — success page branding

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
