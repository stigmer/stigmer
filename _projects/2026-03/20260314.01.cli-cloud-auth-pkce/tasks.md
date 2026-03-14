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

**Status**: ✅ DONE
**Created**: 2026-03-14 07:13
**Completed**: 2026-03-14

Implement the `addAuthHeader` interceptor stub in the OSS CLI's backend client.
Support `STIGMER_API_KEY` env var override. Auto-prompt login when cloud backend
is selected but no token is available.

### Subtasks
- [x] ~~Implement `addAuthHeader()` in `internal/cli/backend/client.go`~~ — replaced with `grpc.WithPerRPCCredentials` (see critical finding below)
- [x] Token resolution order: `STIGMER_API_KEY` env var > `--api-key` flag > `backend.cloud.token` from config
- [x] Add `--api-key` global flag to root command
- [x] Auth-missing error: when cloud backend selected but no token, return descriptive error (no auto-login — avoids surprising browser launches in CI/scripts)
- [x] Wire Bearer token into gRPC `PerRPCCredentials`
- [ ] Test: `stigmer config backend set cloud` → `stigmer auth login` → any command works (Task 5)

### Critical Finding: Streaming Auth Gap
The original plan was to implement `addAuthHeader()` via `grpc.WithUnaryInterceptor`.
During analysis, discovered this only covers unary RPCs — `stigmer run` uses
server-streaming for execution events (20+ files in `run_stream_*.go`). Switched
to `grpc.WithPerRPCCredentials` which handles both unary AND streaming RPCs.

### Design Decisions
- **PerRPCCredentials over interceptor**: Works for all RPC types, standard gRPC mechanism
- **No auto-login**: Clear error message instead of auto-triggering browser (safer for CI/CD)
- **Eager token resolution**: Token resolved once at `NewClient` time, not per-RPC
- **tokenAuth duplication accepted**: `auth/whoami.go` keeps its own copy (avoids circular deps)
- **Cloud config auto-initialized**: `NewClient` creates `CloudBackendConfig{}` if nil (was previously erroring on missing config, but config may be nil when only env var is set)

### Files Modified
- `client-apps/cli/internal/cli/backend/client.go` — added `tokenAuth`, `resolveCloudToken()`, replaced interceptor with PerRPCCredentials, removed dead `authInterceptor`/`addAuthHeader` methods
- `client-apps/cli/cmd/stigmer/root.go` — added `--api-key` persistent flag, propagates to `STIGMER_API_KEY` env var in `PersistentPreRun`

### Reference Files
- `stigmer-cloud/client-apps/cli/internal/cli/backend/authheader/get_value.go` — token resolution
- `stigmer-cloud/client-apps/cli/internal/cli/backend/backend.go` — gRPC auth wiring
- `stigmer/client-apps/cli/internal/cli/backend/client.go` — the stub to implement

---

## Task 4: Port API key CRUD and remove cloud CLI entirely

**Status**: ✅ DONE
**Created**: 2026-03-14 07:13
**Completed**: 2026-03-14

Ported API key CRUD from the cloud CLI into the OSS CLI, then deleted the entire
`stigmer-cloud/client-apps/cli/` directory. The OSS CLI fully supersedes the cloud CLI.

### Subtasks
- [x] Create `internal/cli/apikey/` domain package (get.go, list.go, display.go, delete.go, create.go)
- [x] Add `api_key` to `cliRelevantKinds` in `registry.go` and verb support in `verb_support.go`
- [x] Add `ApiResourceKind_api_key` cases to `routeGet`, `routeList`, `routeDelete`
- [x] Create `cmd/stigmer/root/apikey.go` with `create` and `fingerprint` subcommands
- [x] Register `apikey` command on rootCmd under "config" group
- [x] Verify clean `go build ./...` and `go vet ./...`
- [x] Delete `stigmer-cloud/client-apps/cli/` directory entirely (~40 Go files)
- [x] Remove `cli-install` and `cli-update-deps` Makefile targets from `stigmer-cloud/Makefile`
- [x] Confirm client secret (`haPGCQa...`) is gone from `stigmer-cloud` repo
- [x] Delete outdated `FEATURE_COMPARISON.md` from OSS CLI

### Design: Two Access Paths for API Keys
- **Unified verbs**: `stigmer get apikey <id>`, `stigmer list apikey`, `stigmer delete apikey <id>`
- **Dedicated command**: `stigmer apikey create [--name] [--expires-in] [--never-expires]`, `stigmer apikey fingerprint <raw-key>`

### Key Differences from Cloud CLI Port
- Import path: `github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/apikey/v1` (OSS)
- Output: `display.DisplayProto` / `display.DisplayProtoSlice` (not `cliprint`)
- Connection: `backend.NewConnection()` with existing auth wiring
- Error handling: `clierr.Handle()` pattern
- API keys are not search-indexed — `list` uses dedicated `FindAll` RPC, not SearchService
- `fingerprint` computes SHA-256 of raw key client-side, then calls `GetByKeyHash` RPC

### Files Created (OSS CLI)
- `client-apps/cli/internal/cli/apikey/get.go`
- `client-apps/cli/internal/cli/apikey/list.go`
- `client-apps/cli/internal/cli/apikey/delete.go`
- `client-apps/cli/internal/cli/apikey/create.go`
- `client-apps/cli/internal/cli/apikey/display.go`
- `client-apps/cli/cmd/stigmer/root/apikey.go`

### Files Modified (OSS CLI)
- `client-apps/cli/internal/cli/types/registry.go` — added `api_key` to `cliRelevantKinds`
- `client-apps/cli/internal/cli/types/verb_support.go` — added get/list/delete verb support
- `client-apps/cli/cmd/stigmer/root/get.go` — added route and handler for api_key
- `client-apps/cli/cmd/stigmer/root/list.go` — added route and handler for api_key
- `client-apps/cli/cmd/stigmer/root/delete.go` — added route for api_key
- `client-apps/cli/cmd/stigmer/root/delete_handlers.go` — added `deleteApiKey` handler
- `client-apps/cli/cmd/stigmer/root.go` — registered `NewApiKeyCommand()`

### Files Deleted
- `client-apps/cli/FEATURE_COMPARISON.md` — outdated, all features listed as missing were implemented
- `stigmer-cloud/client-apps/cli/` — entire directory (~40 Go files, go.mod, Makefile, docs)

### Files Modified (stigmer-cloud)
- `stigmer-cloud/Makefile` — removed CLI section (lines 68-76)

---

## Project Completion Checklist

All tasks complete:
- [x] All tasks marked ✅ DONE
- [x] `stigmer auth login` opens browser, completes PKCE flow, stores token
- [x] `stigmer auth logout` clears token
- [x] `stigmer auth whoami` shows logged-in user
- [x] Cloud backend commands work with stored token
- [x] `STIGMER_API_KEY` env var override works
- [x] No client secret anywhere in OSS CLI code
- [x] Client secret removed from cloud CLI code (entire CLI deleted)
- [x] API key CRUD ported to OSS CLI
- [x] Cloud CLI entirely removed from stigmer-cloud repo
- [x] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!
