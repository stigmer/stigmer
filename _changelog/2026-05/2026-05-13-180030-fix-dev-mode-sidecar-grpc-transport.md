# Fix Dev-Mode Runner Startup: Sidecar gRPC Transport Mismatch

**Date**: May 13, 2026

## Summary

Fixed the Desktop runner failing to start in dev mode by separating the frontend gRPC-Web proxy URL from the CLI sidecar's native gRPC target, adding an `--insecure` CLI flag, and auto-detecting localhost endpoints as plaintext. The CLI was attempting TLS against the local Caddy proxy because the presence of a PKCE token caused `ResolveBackendInfo` to assume cloud mode.

## Problem Statement

In dev mode (`make desktop-dev`), the Desktop app connects to `http://localhost:9090` (Caddy proxy) and uses PKCE authentication (`VITE_STIGMER_FORCE_AUTH=true`). When the auto-ensure lifecycle starts the CLI sidecar, it passes the same URL as the gRPC endpoint along with the JWT token. The CLI's `ResolveBackendInfo` saw a non-empty token and set `IsLocal=false`, causing `createClient()` to skip `WithInsecure()` and attempt a TLS handshake against the plaintext Caddy proxy. The connection timed out after 10 seconds, crashing the CLI with exit code 1.

### Pain Points

- Runner startup always failed in dev mode with `VITE_STIGMER_FORCE_AUTH=true`
- The CLI had no way to use plaintext gRPC independently of the `IsLocal` flag
- `ResolveBackendInfo` assumed "token present = cloud = TLS" with no localhost override
- The Desktop passed its own gRPC-Web proxy URL to the CLI sidecar, which needed a native gRPC target

## Solution

Three-layer fix across the Go CLI, Rust sidecar, and TypeScript Desktop:

1. **`--insecure` CLI flag** for explicit plaintext gRPC, matching the standard pattern used by Docker, kubectl, and gRPC tooling
2. **Localhost auto-detection** in `ResolveBackendInfo` that sets `Insecure=true` for `localhost`/`127.0.0.1`/`::1` endpoints regardless of token presence
3. **Separate sidecar endpoint** configuration via `VITE_STIGMER_SIDECAR_ENDPOINT` env var with automatic `insecure` derivation from the API URL

## Implementation Details

### Go CLI (`up.go`, `start.go`, `backend_info.go`)

Added `--insecure` boolean flag to both `stigmer up` and `stigmer up runner` commands. Threaded through `StartOptions.Insecure` -> `ResolveOptions.Insecure` -> `BackendInfo.Insecure`. The `createClient` function now uses `info.IsLocal || info.Insecure` to decide whether to add `WithInsecure()`.

Added `isLocalhostEndpoint()` helper in `backend_info.go` that parses the host from a `host:port` string and checks for loopback addresses. `ResolveBackendInfo` calls this after endpoint resolution and sets `Insecure=true` automatically, so even without the `--insecure` flag, localhost endpoints use plaintext gRPC.

### Rust Sidecar (`sidecar.rs`)

Added `insecure: Option<bool>` parameter to the `start_runner` Tauri command. When `Some(true)`, appends `--insecure` to the CLI sidecar arguments.

### TypeScript Desktop (`tauri.ts`, `RunnersPage.tsx`)

Added `insecure?: boolean` to `StartRunnerOptions` and `invokeStartRunner`.

In `RunnersPage.tsx`, added module-level constants: `SIDECAR_ENDPOINT` (from `VITE_STIGMER_SIDECAR_ENDPOINT` with fallback to `toGrpcTarget(BASE_URL)`) and `SIDECAR_INSECURE` (derived from `isLocalEndpoint(BASE_URL)`). All `startRunner` calls now use these instead of `toGrpcTarget(cred.endpoint)`.

### Environment Configuration (`.env.development`)

Added `VITE_STIGMER_SIDECAR_ENDPOINT=localhost:9090`. Production builds don't need this — they fall back to deriving the endpoint from `VITE_STIGMER_API_URL` via `toGrpcTarget()`.

## Benefits

- Dev-mode runner startup works with `VITE_STIGMER_FORCE_AUTH=true` (PKCE + localhost)
- CLI has a standard `--insecure` flag for any non-TLS backend, useful in CI/containers
- Localhost endpoints automatically use plaintext — no manual `--insecure` needed
- Frontend and sidecar endpoints are independently configurable
- Production (cloud) mode is unaffected — TLS remains the default for non-localhost

## Impact

- **Desktop dev mode**: Runner startup no longer fails with gRPC TLS timeout
- **CLI users**: New `--insecure` flag available for connecting to any plaintext gRPC backend
- **Production**: No behavior change — localhost auto-detection only affects loopback addresses

## Related Work

- `1c9fd48c2` — Runner ensure timeout and failure detection (same session)
- `ff62e39a6` — Previous runner startup latency fix
- `2781b68b9` — Local dev proxy with grpcwebproxy and Caddy

---

**Status**: Production Ready
**Timeline**: Single session
