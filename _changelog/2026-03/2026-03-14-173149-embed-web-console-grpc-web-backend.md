# Embed Web Console in Daemon with gRPC-Web Backend

**Date**: March 14, 2026

## Summary

Added gRPC-Web support to stigmer-server so browsers can communicate with the API, and embedded the static web console in the CLI daemon binary — mirroring the cloud topology where frontend and backend are separate services connected via gRPC. The web console is served on port 8234 while the API remains on port 7234, maintaining the established 7xxx=API, 8xxx=UI port convention.

## Problem Statement

The web console (Next.js static export) uses `createGrpcWebTransport` from `@connectrpc/connect-web` to talk to the backend. However, stigmer-server is a pure gRPC server that only speaks native gRPC over HTTP/2 — a protocol browsers cannot use. In stigmer-cloud, Envoy proxy bridges this gap. No such proxy exists in OSS local mode.

### Pain Points

- Browsers cannot speak native gRPC (HTTP/2 binary framing) — they require gRPC-Web (HTTP/1.1 compatible wire format)
- No gRPC-Web translation layer existed in OSS local mode
- The web console had no embedding mechanism to serve from the CLI binary
- No build coordination existed to produce embedded assets

## Solution

A four-phase implementation that adds the gRPC-Web protocol bridge and embeds the web console in the daemon:

1. **gRPC-Web support via h2c multiplexing** — stigmer-server now accepts both native gRPC (for CLI/runners) and gRPC-Web (for browsers) on the same port using HTTP/2 cleartext (h2c)
2. **Embed package with build tag** — `//go:embed` packages the static web assets into the CLI binary, controlled by `embed_webconsole` build tag
3. **Daemon-hosted web server** — in-process HTTP server on port 8234, not a subprocess, following the principle that lightweight services run as goroutines
4. **Build coordination** — Makefile targets to build web assets and produce the embedded binary

## Implementation Details

### Phase 1: gRPC-Web Support

**Shared library** (`backend/libs/go/grpc/server.go`):
- Added `StartHTTP(port, handler)` method using `h2c.NewHandler` for HTTP/2 cleartext support
- Added `IsGRPCRequest()` helper for handler routing
- Updated `Stop()` to gracefully shut down the HTTP server before the gRPC server

**stigmer-server** (`backend/services/stigmer-server/pkg/server/server.go`):
- Wrapped existing `*grpc.Server` with `improbable-eng/grpc-web` (`grpcweb.WrapServer`)
- CORS enabled for all origins (local dev mode; cloud uses Envoy)
- WebSocket transport enabled for server-streaming RPCs
- Unified handler routes: gRPC-Web → wrapper, native gRPC → `grpcServer.ServeHTTP`, else → 404
- Zero changes to any of the 15+ service controllers or gRPC interceptors

### Phase 2: Web Console Embed Package

**`client-apps/cli/embedded/webconsole/`** — three files following the agentrunner pattern:
- `webconsole.go` — package-level `assetsFS` variable, `FS()` and `IsAvailable()` accessors
- `webconsole_embed.go` — `//go:embed all:out` with `embed_webconsole` build tag, strips `out/` prefix via `fs.Sub`
- `handler.go` — SPA-aware HTTP handler: serves files from embedded FS, falls back to `index.html` for client-side routing, immutable cache headers for `_next/static/` assets

### Phase 3: Daemon Integration

- Added `WebConsolePort = 8234` constant
- After all child components start, if `webconsole.IsAvailable()`, starts an in-process HTTP server on port 8234
- Registered as `web-console` in `HealthState` (reported by `stigmer server status`)
- Graceful shutdown: HTTP server stops before child processes on daemon exit

### Phase 4: Build Coordination

- `make web-console-build` — runs `npm run build` via workspace, copies `out/` to embed location
- `make build-release` — now produces a binary with both agent-runner and web console embedded
- `.gitignore` — excludes `client-apps/cli/embedded/webconsole/out/` (build artifact)

## Benefits

- **Cloud topology parity**: Console on 8234, API on 7234 — same cross-origin gRPC-Web path as production
- **Zero implementation branching**: Web console transport code is identical in local and cloud modes
- **Resilience**: If stigmer-server crashes, the web console stays loaded and shows disconnected state
- **Optional embedding**: Without the `embed_webconsole` build tag, the binary is leaner and the daemon skips the web server
- **No new dependencies for users**: The web console is baked into the CLI binary — no Node.js runtime needed

## Impact

- **CLI users**: `stigmer server` now serves a web console at `http://localhost:8234` (when built with `embed_webconsole`)
- **Native gRPC clients**: Completely unaffected — h2c is transparent to existing CLI, workflow-runner, and agent-runner connections
- **Web console**: Can now communicate with stigmer-server via gRPC-Web without any proxy
- **Build system**: `make build-release` now produces a fully self-contained binary

## Related Work

- T01–T04 (TypeScript codegen, web migration, auth, static export) — prerequisites that produced the web console assets
- T06 (CLI Integration & Polish) and T07 (Build Pipeline & Dev Workflow) — follow-up tasks

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation
