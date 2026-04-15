# CLI Go SDK Refactor: SDK-First Architecture for the CLI

**Date**: April 15, 2026

## Summary

Refactored the Stigmer CLI to consume the Go SDK (`sdk/go`) for connection management, auth, and proto types instead of using raw protobuf stubs and a custom transport layer. This establishes the SDK as the canonical Go client — mirroring the TypeScript architecture where `@stigmer/sdk` is consumed by `@stigmer/react`, `@stigmer/ink`, and `client-apps/web`. Also decoupled the CLI binary from `stigmer-server` and `workflow-runner` to resolve a protobuf registration conflict and improve separation of concerns.

## Problem Statement

The CLI bypassed the Go SDK entirely, constructing raw gRPC clients from `apis/stubs/go` protobuf stubs with its own transport/auth layer (~300 lines of custom TLS, PerRPCCredentials, keepalive, and connection management). Meanwhile, `sdk/go` provided a published Go SDK with 19 resource sub-clients, streaming, and error wrapping — but zero first-party consumers.

### Pain Points

- The CLI was a parallel implementation rather than a reference implementation consuming the SDK
- Transport, auth, and connection logic was duplicated between CLI and SDK
- The SDK had no real consumer to validate its ergonomics
- Proto types from `apis/stubs/go` conflicted with `sdk/go/proto` in the same binary (Go protobuf global registry panics on duplicate `.proto` file registration)
- The CLI embedded `stigmer-server` and `workflow-runner` via the BusyBox pattern, pulling in the entire backend dependency graph

## Solution

Three-phase refactoring:

1. **Enhanced the Go SDK** to support CLI auth patterns (API key, login token, no-auth local mode, keepalive)
2. **Migrated all CLI proto imports** from `apis/stubs/go` to `sdk/go/proto` (170+ files, mechanical import path swap)
3. **Decoupled the CLI from backend services** by removing BusyBox embedding of stigmer-server/workflow-runner — the daemon now launches standalone binaries

## Implementation Details

### Go SDK Auth Model Enhancement

- Changed `NewClient(apiKey, ...opts)` to `NewClient(...opts)` — breaking change, safe since SDK has no external consumers yet
- Added `WithAPIKey(key)` and `WithToken(token)` for the two auth modes
- Added `WithKeepaliveParams(params)` for long-running execution streams
- Added `Connect(ctx)` method for eager connectivity verification (replaces deprecated `grpc.WithBlock()`)
- Added `Conn()` accessor for transitional raw stub access
- Insecure targets (local dev) can skip credentials entirely

### CLI Backend Rewrite

Replaced ~300 lines of custom transport/auth/TLS/PerRPCCredentials in `backend/client.go` with ~60 lines that construct a `*stigmer.Client` via `stigmer.NewClient(opts...)`.

### Proto Type Migration

All ~170 CLI Go files switched from `apis/stubs/go/ai/stigmer/...` to `sdk/go/proto/ai/stigmer/...`. Two new CLI-local packages replace `backend/libs/go` dependencies:
- `internal/cli/kindmeta` — proto enum metadata helpers (replaces `backend/libs/go/apiresource`)
- `internal/cli/mcpdiscovery` — MCP capability discovery using SDK proto types (replaces `backend/libs/go/mcpdiscovery`)

### BusyBox Decoupling

Removed `internal-server` and `internal-workflow-runner` hidden Cobra commands that linked `stigmer-server` and `workflow-runner` into the CLI binary. The daemon now finds standalone `stigmer-server` and `stigmer-workflow-runner` binaries alongside the CLI executable or in PATH.

## Benefits

- **~940 fewer lines** in the CLI dependency graph (go.sum shrank by 783 lines)
- **SDK-first architecture**: CLI is now a reference implementation consuming the SDK
- **Single proto source**: `sdk/go/proto` is the canonical Go proto package — no dual registration conflicts
- **Cleaner binary**: CLI no longer links the entire backend server stack
- **SDK validated**: The Go SDK now has a real consumer driving its design (auth flexibility, keepalive, Connect method all driven by CLI needs)

## Impact

- **CLI binary**: smaller, no longer crashes from proto conflicts, no longer embeds server
- **Go SDK**: enhanced auth model, ready for external consumers
- **Local daemon mode**: now requires separate `stigmer-server` and `stigmer-workflow-runner` binaries (found alongside CLI or in PATH)
- **Release pipeline**: needs updating to ship server/runner as separate binaries alongside the CLI

## Related Work

- Part of the CLI Modernization project (`_projects/2026-04/20260415.01.cli-modernization`)
- Follows T01-T03 (apply handlers, CI guards, connect/slug audit)
- Precedes T04 Phase 2 (Ink CLI integration)
- Related: `@stigmer/ink` SDK package (T04 Phase 1, completed in sessions 4-5)

---

**Status**: Production Ready
**Timeline**: 1 session (~3 hours)
