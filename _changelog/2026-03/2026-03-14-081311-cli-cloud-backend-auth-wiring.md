# Wire Cloud Backend Auth into OSS CLI

**Date**: March 14, 2026

## Summary

Replaced the placeholder auth interceptor in the OSS CLI's gRPC backend client with a working bearer token implementation using `grpc.WithPerRPCCredentials`. Added `--api-key` global flag and `STIGMER_API_KEY` env var support for CI/CD scenarios. This completes the auth pipeline: `stigmer auth login` stores a token, and every subsequent gRPC call — unary and streaming — sends it automatically.

## Problem Statement

After Tasks 1-2 established the PKCE login flow and token storage, the stored token was never actually sent to the cloud backend. The `addAuthHeader` method in `backend/client.go` was a TODO stub that returned the context unchanged. Additionally, the existing approach used `grpc.WithUnaryInterceptor`, which would only cover unary RPCs.

### Pain Points

- Cloud backend commands silently failed auth — token stored but never sent
- `grpc.WithUnaryInterceptor` would miss streaming RPCs (`stigmer run` execution events — 20+ files in `run_stream_*.go`)
- No support for API key override for CI/CD pipelines or scripted usage
- No clear error message when cloud mode was selected without authentication

## Solution

Switched from the unary interceptor approach to `grpc.WithPerRPCCredentials`, which is the standard gRPC mechanism for per-call credentials. This injects the `Authorization: Bearer <token>` header into every RPC — both unary and streaming — automatically. Added token resolution with documented priority and a global `--api-key` flag.

## Implementation Details

### Token Resolution (`resolveCloudToken`)

Priority chain:
1. `STIGMER_API_KEY` environment variable (highest — for CI/CD, scripts, `--api-key` flag)
2. `backend.cloud.token` from `~/.stigmer/config.yaml` (normal interactive login flow)

### `tokenAuth` (PerRPCCredentials)

A 10-line struct implementing `grpc.PerRPCCredentials` that injects `Authorization: Bearer <token>` into gRPC metadata. `RequireTransportSecurity` returns `false` because transport security is enforced separately by the TLS dial option.

### `--api-key` Global Flag

Added as a persistent flag on the root command. `PersistentPreRun` propagates the value to `STIGMER_API_KEY` env var before any command handler executes, so `resolveCloudToken` picks it up through the standard env var path.

### Dead Code Removal

Removed the `authInterceptor` and `addAuthHeader` methods — they were superseded by `PerRPCCredentials` and had no other callers.

## Benefits

- **Complete auth pipeline**: Login stores token, every RPC sends it — no gaps
- **Streaming auth**: Server-streaming RPCs (agent execution events) now authenticate correctly in cloud mode
- **CI/CD support**: `STIGMER_API_KEY` env var or `--api-key` flag for non-interactive usage
- **Clear errors**: Descriptive message when cloud mode lacks authentication, directing users to `stigmer auth login`
- **No new packages**: All changes within existing `backend` and `root` packages

## Impact

- **Users**: `stigmer auth login` followed by any command now works end-to-end against the cloud backend
- **CI/CD**: `STIGMER_API_KEY=xxx stigmer run` or `stigmer --api-key xxx run` for automated pipelines
- **Codebase**: Net reduction in lines of code (removed 24-line interceptor stub, added 37 lines of working auth)

## Files Changed

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/backend/client.go` | Added `tokenAuth`, `resolveCloudToken`, replaced interceptor with PerRPCCredentials, removed dead methods |
| `client-apps/cli/cmd/stigmer/root.go` | Added `--api-key` persistent flag with env var propagation |

## Design Decisions

- **PerRPCCredentials over interceptor**: Works for all RPC types, standard gRPC pattern
- **No auto-login**: Error message instead of auto-triggering browser (safer for CI/CD)
- **tokenAuth duplication accepted**: `auth/whoami.go` keeps its own copy to avoid circular dependencies
- **Eager token resolution**: Token resolved once at client creation, not per-RPC

## Related Work

- [CLI Auth Commands PKCE Scaffold](2026-03-14-073329-cli-auth-commands-pkce-scaffold.md) — Task 1
- [CLI PKCE OAuth Login Flow](2026-03-14-074848-cli-pkce-oauth-login-flow.md) — Task 2
- Task 4 (next): Delete auth from cloud CLI

---

**Status**: Production Ready
**Project**: 20260314.01.cli-cloud-auth-pkce (Task 3 of 5)
