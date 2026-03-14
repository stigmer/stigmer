# CLI Auth Commands and PKCE Config Scaffold

**Date**: March 14, 2026

## Summary

Added `stigmer auth login`, `auth logout`, and `auth whoami` commands to the OSS CLI, along with a PKCE-safe Auth0 configuration that contains no client secrets. This is the foundational layer for migrating cloud authentication from the closed-source CLI to the open-source CLI using the PKCE OAuth flow.

## Problem Statement

The Stigmer Cloud CLI (`stigmer-cloud`) embeds an Auth0 client secret for user authentication. This prevents the auth flow from being available in the open-source CLI and creates a security concern — client secrets should not be distributed in public binaries.

### Pain Points

- OSS CLI users cannot authenticate with the Stigmer cloud backend
- Auth0 client secret is embedded in the cloud CLI binary
- No `stigmer auth` command exists in the OSS CLI
- Cloud backend requires an authenticated gRPC connection with no way to acquire tokens from the OSS CLI

## Solution

Scaffold the complete auth command structure and PKCE-safe configuration in the OSS CLI. PKCE (Proof Key for Code Exchange) eliminates the need for a client secret entirely — the code verifier/challenge pair proves the authorization request came from the same client that initiated it. This session implements the command layer and config; the actual PKCE login flow follows in the next task.

## Implementation Details

### New Files

- **`internal/cli/auth/config.go`** — Auth0 PKCE constants (`Domain`, `ClientID`, `Audience`, `CallbackPort`) and `NewOAuthConfig()` builder. Uses `golang.org/x/oauth2` directly with no client secret. Auth0 endpoints are hardcoded (stable, avoids OIDC discovery dependency).

- **`internal/cli/auth/login.go`** — Stub `Login()` returning a not-implemented error. Full PKCE flow (browser open, localhost callback, token exchange) deferred to Task 2.

- **`internal/cli/auth/whoami.go`** — `FetchIdentity()` creates a standalone authenticated gRPC connection using `tokenAuth` (implements `grpc.PerRPCCredentials`) and calls the WhoAmI RPC. Operates independently of the main `backend.Client`, which gets auth wiring in a later task.

- **`cmd/stigmer/root/auth.go`** — Cobra command structure: `auth` parent with `login`, `logout`, `whoami` subcommands. All handlers use the `clioutput` structured rendering pattern with `--output` format support.

### Modified Files

- **`cmd/stigmer/root.go`** — Registered `auth` command in the "Configuration" command group.
- **`cmd/stigmer/root/backend.go`** — Updated stale hint from `stigmer login` to `stigmer auth login`.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| PKCE implementation | `golang.org/x/oauth2` native | Already a project dependency at v0.34.0, provides `GenerateVerifier()` / `S256ChallengeOption()` |
| Package structure | Flat `internal/cli/auth/` | Follows OSS CLI coding guidelines; avoids premature sub-packaging |
| Auth0 endpoints | Hardcoded | Stable, well-known; avoids `go-oidc` dependency and network call |
| WhoAmI auth | Standalone gRPC connection | Keeps Task 1 independent of backend.Client auth interceptor (Task 3) |

## Benefits

- **Security**: No client secret in the open-source codebase — PKCE eliminates it by design
- **User experience**: Clean `stigmer auth login/logout/whoami` CLI surface matching industry conventions
- **Incremental delivery**: Compiles and runs today with graceful stubs; each subsequent task adds functionality independently
- **Zero new dependencies**: Leverages existing `golang.org/x/oauth2` — no new packages introduced

## Impact

- **OSS CLI users**: Gain auth command surface (functional login flow coming in next task)
- **Cloud CLI**: No changes yet — auth removal is a separate later task
- **Backend services**: No changes — WhoAmI RPC already exists and works with bearer tokens

## Related Work

- Task 2: PKCE login flow implementation (browser open, callback server, token exchange)
- Task 3: Wire bearer token into `backend.Client.addAuthHeader` interceptor
- Task 4: Delete auth from cloud CLI
- Task 5: Integration testing

---

**Status**: ✅ Production Ready (scaffold — login stub returns not-implemented until Task 2)
**Timeline**: 1 session
