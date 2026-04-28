# Runner Platform Builder Integration Guide

**Date**: April 28, 2026

## Summary

Added a platform builder integration guide documenting the CLI sidecar pattern — the architecture where the `stigmer` CLI binary is bundled alongside a desktop or server application to manage runner processes on behalf of users. Removed Docker, PyPI, and environment variable reference pages that documented non-functional standalone deployment paths.

## Problem Statement

The T05 runner documentation task initially produced three deployment guides (Docker, PyPI, environment variables) that assumed the Python agent-runner is a self-contained runner. Investigation revealed a critical architectural gap: the Python process is only a Temporal worker. Runner registration (`Runner.Apply`), heartbeats, the bidirectional gRPC command stream, and server-initiated commands (Stop, ListDirectory) all live in the Go CLI. Running `docker run ghcr.io/stigmer/agent-runner` or `stigmer-runner` without a Go CLI companion produces a process that can execute Temporal activities but cannot register, heartbeat, or be managed from the web console.

### Pain Points

- Docker and PyPI guides documented deployment paths that don't produce functional runners
- Platform builders following those guides would get processes that never appear in Settings > Runners
- No documentation existed for the CLI sidecar pattern — the actual integration path used by the Stigmer Desktop app

## Solution

Replaced the standalone deployment guides with a single platform builder integration guide that documents the CLI sidecar pattern. The guide covers the full integration surface: bundling the binary, spawning `stigmer up runner`, monitoring via stdout and state files, stopping via SIGTERM or `stigmer down runner`, browser-to-app deep links with launch tokens, and the SDK runner management API.

## Implementation Details

**New file**: `docs/guides/runners/platform-integration.mdx` — 280 lines covering:
- Architecture diagram (app → CLI → backend/Temporal)
- CLI binary build targets and embedding (`embed_agentrunner` tag)
- Desktop app example using `Tauri` `externalBin`
- `stigmer up runner` flag reference
- Startup grace period pattern (8s, stderr monitoring)
- State files at `~/.stigmer/runners/<name>.json`
- Stop patterns (SIGTERM vs `stigmer down runner --name`)
- Deep link launch token flow (`createLaunchToken` → URL scheme → `exchangeLaunchToken`)
- SDK `RunnerClient` API cross-reference

**Removed from navigation** (files kept on disk): `docker-deployment.mdx`, `pypi-package.mdx`, `environment-variables.mdx`

**Updated**: `overview.mdx` (simplified cards), `concepts/runners.mdx` (updated What's next links), `meta.json` (page list)

## Benefits

- Platform builders get accurate guidance that matches how the system actually works
- The CLI sidecar pattern is now documented with the same level of detail as the CLI and Desktop guides
- No risk of users deploying non-functional standalone runners by following the docs

## Impact

- **Runner docs section**: Restructured from 6 pages to 4 (overview, local-runner, stop-and-cleanup, platform-integration)
- **Platform builders**: Now have a clear integration path with working code patterns
- **Desktop app**: Explicitly positioned as the reference implementation of the sidecar pattern

## Related Work

- T04: PyPI package (`stigmer-runner`) — the package itself is valid for the CLI's native runtime bootstrap; standalone usage is what's unsupported
- Desktop sidecar implementation: `client-apps/desktop/src-tauri/src/sidecar.rs`
- Runner command stream: `client-apps/cli/internal/cli/daemon/runner_stream.go`

---

**Status**: ✅ Production Ready
