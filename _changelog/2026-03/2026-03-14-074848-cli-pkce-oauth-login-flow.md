# CLI: PKCE OAuth Login Flow

**Date**: March 14, 2026

## Summary

Implemented the full PKCE (Proof Key for Code Exchange) OAuth login flow in the OSS CLI, replacing the stub from Task 1. This enables `stigmer auth login` to securely authenticate users with Auth0 via the browser without embedding a client secret — a critical requirement for open-source distribution. The implementation improves on the cloud CLI's reference code with proper state validation, channel-based concurrency, graceful shutdown, and timeout handling.

## Problem Statement

The Stigmer Cloud CLI embeds an Auth0 client secret directly in the source code. This secret cannot be included in the open-source repository. PKCE eliminates the client secret entirely by replacing it with a one-time cryptographic proof generated at runtime — the industry standard for public/native CLI clients.

### Pain Points

- The OSS CLI's `stigmer auth login` was a stub returning "not yet implemented"
- No way for open-source users to authenticate with Stigmer Cloud
- The cloud CLI's login implementation had several design issues that shouldn't be ported as-is

## Solution

Four new files in `internal/cli/auth/` implement the complete PKCE flow:

1. **`login.go`** — Orchestrates the flow: generate PKCE verifier + state, start callback server, open browser, wait for callback, validate state, exchange code for token, persist token and auto-switch to cloud backend
2. **`callback.go`** — `callbackServer` struct managing the HTTP callback server lifecycle with eager port binding, channel-based result passing, and graceful shutdown
3. **`browser.go`** — Cross-platform browser opening utility (macOS/Linux/Windows)
4. **`pages.go`** — Polished success/error HTML pages with animated SVG icons

## Implementation Details

### PKCE Flow (golang.org/x/oauth2 native)

- `oauth2.GenerateVerifier()` for code_verifier generation
- `oauth2.S256ChallengeOption(verifier)` adds code_challenge to auth URL
- `oauth2.VerifierOption(verifier)` sends code_verifier in token exchange
- No manual HTTP POST needed — the oauth2 library handles everything

### Improvements Over Cloud CLI

| Aspect | Cloud CLI | OSS CLI |
|--------|-----------|---------|
| Auth code transfer | Temp file on disk | Go channel |
| State validation | Generated but never checked | Validated (CSRF protection) |
| HTTP mux | Global `http.DefaultServeMux` | Dedicated `http.ServeMux` |
| Server shutdown | Never shut down | Graceful `server.Shutdown()` |
| Timeout | Waits forever | 5-minute context deadline |
| State generation | `github.com/google/uuid` | `oauth2.GenerateVerifier()` (no extra dep) |

### Design Decision: Always Re-authenticate

Rather than checking token validity on login (which adds ~5s latency for a WhoAmI RPC), `stigmer auth login` always starts the browser flow. This matches `gcloud auth login` and `gh auth login` behavior — simpler, no latency, always gets a fresh token.

### Binary Size: Skipped 1.1MB Logo

The cloud CLI embeds a 1.1MB `logo.svg` for the callback success page. The OSS CLI skips this and uses animated inline SVG checkmark/X icons instead, keeping the binary lean.

## Benefits

- Open-source users can now authenticate with Stigmer Cloud securely
- No secrets in the OSS codebase — Auth0 client ID and domain are public metadata
- Clean, testable implementation with proper concurrency patterns
- CSRF-safe with state validation
- Resilient with timeout and graceful shutdown

## Impact

- **OSS CLI users**: Can now run `stigmer auth login` to authenticate with Stigmer Cloud
- **Security**: Eliminates the need for client secrets in publicly distributed code
- **Codebase quality**: Sets the standard for the auth module that Task 3 (backend wiring) and Task 4 (cloud CLI cleanup) will build on

## Related Work

- Task 1 (same project): Scaffolded auth commands and PKCE config
- Task 3 (next): Wire bearer token into `backend.Client.addAuthHeader` interceptor
- Task 4 (upcoming): Delete auth from cloud CLI (remove embedded client secret)

---

**Status**: ✅ Production Ready
**Timeline**: Task 2 of 5 in the cli-cloud-auth-pkce project
