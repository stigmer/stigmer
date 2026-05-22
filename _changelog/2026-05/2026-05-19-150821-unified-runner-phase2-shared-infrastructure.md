# Unified Runner Phase 2: Core Shared Infrastructure

**Date**: May 19, 2026

## Summary

Phase 2 of the unified runner migration adds harness-agnostic shared modules under `backend/services/runner/src/shared/`. ExecuteDeepAgent (Phase 3) can now reuse status persistence, LangGraph checkpointers, workspace provisioning, and MCP connection lifecycle instead of reimplementing them per activity. ExecuteCursor was refactored to consume shared status utilities. The work ships with 52 new unit tests (70 total in the runner package), all passing with clean typecheck and build.

## Problem Statement

Phase 1 scaffolded the unified runner with ExecuteCursor fully ported and ExecuteDeepAgent as a stub. Deep-agent execution still depends on Python `agent-runner` for checkpointers, workspace setup, MCP process management, and status streaming patterns that were not yet available in TypeScript.

### Pain Points

- Status persistence (`persistStatus`, `slimStatus`, setup progress) was duplicated inside ExecuteCursor only
- No LangGraph checkpointer for OSS (memory) or cloud (HTTP proxy via Stigmer service)
- Workspace provisioning (git clone, local path, empty) existed only in Python
- Deep-agent MCP lifecycle (`MultiServerMCPClient`) had no TypeScript equivalent wired into the runner
- StatusBuilder for LangGraph `astream_events` was premature to build without a concrete consumer

## Solution

Extract and implement four shared capability areas in `src/shared/`, following the harness-agnostic vs harness-specific split established in Phase 1.

| Module | Purpose |
|--------|---------|
| `shared/status.ts` | gRPC status persistence, slim Temporal payloads, UTC timestamps |
| `shared/checkpointer/` | MemorySaver (local/OSS) + HttpCheckpointSaver (cloud proxy) |
| `shared/workspace/` | Git/local/empty workspace provisioning with local backend |
| `shared/mcp-manager.ts` | `MultiServerMCPClient` wrapper with cloud compatibility warnings |

StatusBuilder for LangGraph events was **deferred to Phase 3** — event shapes differ fundamentally from Cursor SDK streaming and building a shared abstraction without ExecuteDeepAgent would be speculative.

Checkpointer strategy per product decision: **memory for OSS, HTTP proxy for cloud** (no direct MongoDB or SQLite in the runner).

## Implementation Details

### Status utilities (`shared/status.ts`)

- `persistStatus`, `reportSetupProgress`, `slimStatus`, `utcTimestamp`
- ExecuteCursor imports from shared; local duplicates removed from `execute-cursor/index.ts`
- `message-translator.ts` re-exports `utcTimestamp` from shared for backward compatibility

### Checkpointer (`shared/checkpointer/`)

- `factory.ts` selects backend from `Config.checkpointerType` (defaults: local → memory, cloud → http)
- `http-saver.ts` ports Python `HttpCheckpointSaver`: implements LangGraph JS `BaseCheckpointSaver`, MongoDB Extended JSON v2 `$binary` serialization for Java `CheckpointerProxyController` compatibility
- Uses `this.serde` from `BaseCheckpointSaver` (JsonPlusSerializer is not a public subpath export)

### Workspace (`shared/workspace/`)

- `WorkspaceProvisioner` dispatches on proto-shaped `WorkspaceSource` (git, local path, empty)
- Git: token injection for GitHub HTTPS, idempotent re-clone detection, `.stigmer` git excludes
- Local path: absolute-path validation, cloud-mode rejection, multi-entry symlinks
- `LocalWorkspaceBackend` for shell/file operations (Daytona remote backend deferred to Phase 3)

### MCP manager (`shared/mcp-manager.ts`)

- `connectMcpServers()` builds `MultiServerMCPClient` from `ResolvedMcpServer[]`
- `toMcpClientConfig()` maps stdio/http to `@langchain/mcp-adapters` `Connection` format (`transport: "http"`, not Python's `streamable_http`)
- `warnCloudIncompatibleServers()` logs when stdio commands are not npx/node/uvx/python in cloud mode (warn only, no blocking)

### Config

- Added `checkpointerType` and `checkpointerProxyEndpoint` to runner `Config`

### Dependencies

- `@langchain/mcp-adapters`, `@langchain/core` (peer for MCP adapters)

## Benefits

- Phase 3 can wire checkpointer, workspace, MCP, and status without new infrastructure work
- Single implementation of HTTP checkpoint proxy — runner never touches MongoDB directly
- Clear separation: Cursor keeps SDK-specific MCP config; deep agent uses `McpConnectionManager`
- 70 automated tests guard regressions in shared modules

## Impact

- **Developers**: Unified runner package is the single place for cross-harness infrastructure
- **ExecuteCursor**: No behavior change; cleaner imports from shared status helpers
- **ExecuteDeepAgent (Phase 3)**: Unblocked for core wiring
- **Operations**: Cloud MCP stdio limitations are visible in logs without silent failure

## Related Work

- Phase 1 scaffold: `b2997aba3` feat(backend): scaffold unified runner service
- Project: `_projects/2026-05/20260518.01.unified-runner-migration/`
- Checkpoint: `checkpoints/2026-05-19-session-3-phase2.md`
- Gate decision: `design-decisions/003-t01-gate-decision.md`

## MCP / Cursor Cloud Note

Native stdio MCP in Cursor Cloud remains a separate concern from deep-agent MCP: Cursor passes `mcpServers` to the Cursor SDK (npx-installable servers generally work on Cursor's VMs). Deep-agent stdio runs in the runner/sandbox process. Phase 2 adds **validation warnings** only; no proto or blocking filter yet.

---

**Status**: In Progress (Phase 2 complete; Phase 3 next)
**Timeline**: One session (~4 hours implementation + verification)
