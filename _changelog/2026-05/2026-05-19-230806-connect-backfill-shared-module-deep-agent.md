# MCP Connect Backfill: Shared Module + Deep-Agent Wiring

**Date**: May 19, 2026

## Summary

Lifted the MCP connect-backfill logic from the execute-cursor path into a shared module and wired it into the execute-deep-agent setup pipeline. This closes a correctness bug where deep-agent executions against never-connected MCP servers would proceed with empty approval policies that could never self-heal. Also removed the "MCP package pre-installer" from the roadmap after analysis showed it solves no real failure mode.

## Problem Statement

When an MCP server attached to an agent has never been "connected" (tools discovered, approval policies classified), the `discoveredCapabilitiesEmpty` flag is `true` on the resolved server. The execute-cursor path handled this by calling `backfillMcpServersIfNeeded()` before proceeding — triggering the connect RPC to discover tools and classify approvals on-the-fly. The execute-deep-agent path had no such step.

### Pain Points

- First deep-agent execution against an undiscovered MCP server would have no tool approval policies
- All tools would default to "requires approval" (fail-closed) with no mechanism to correct itself
- The backfill logic was cursor-specific despite being harness-agnostic in nature
- The "MCP package pre-installer" was on the roadmap but had no actual use case — all 56 seedpack servers use self-installing commands (npx, uvx, go run)

## Solution

Created a shared `connect-backfill.ts` module with a simplified `ResolvedMcpServer[]` in/out signature, wired it into both execution paths, and refactored the cursor-specific backfill to delegate to the shared module.

## Implementation Details

**New files:**
- `src/shared/connect-backfill.ts` — Core backfill logic: `needsBackfill()` predicate, `backfillMcpServersIfNeeded()` main function, `extractRuntimeEnvForServer()` helper. Uses shared `ResolvedMcpServer[]` interface (harness-agnostic).
- `src/shared/__tests__/connect-backfill.test.ts` — 17 unit tests covering: early return when no backfill needed, connect RPC trigger, failure/timeout resilience, partial success re-resolution, heartbeat callbacks, env var extraction, orphan server handling, missing server ID edge cases.

**Modified files:**
- `src/activities/execute-deep-agent/setup.ts` — Inserted `backfillMcpServersIfNeeded()` between `resolveMcpServers()` and `connectMcpServers()` in the MCP setup step.
- `src/activities/execute-cursor/connect-backfill.ts` — Refactored from full standalone implementation to thin wrapper that delegates to shared module and rebuilds cursor-specific `McpResolutionResult` with `cursorConfig`.

**Key design decisions:**
- Shared function takes `ResolvedMcpServer[]` in, returns `ResolvedMcpServer[]` out — no wrapper types, maximum composability
- Returns the same array reference on early return (no backfill needed) — enables cheap identity checks
- Cursor wrapper preserves existing call site interface (cursor `index.ts` unchanged)
- 60-second per-server timeout with `Promise.race`, non-fatal failures (fail-closed)

## Benefits

- Deep-agent executions now self-heal undiscovered MCP servers at execution time
- Single source of truth for backfill logic (shared module, not duplicated per harness)
- Removed phantom roadmap item (MCP package pre-installer) that would have been pure waste

## Impact

- **Deep-agent users**: First execution against a new MCP server now correctly discovers tools and classifies approval policies before connecting
- **Codebase quality**: Reduced duplication — cursor path delegates to shared module instead of maintaining its own copy
- **Test coverage**: 488 total tests (17 new), all passing, `tsc --noEmit` clean

## Related Work

- Phase 4 of the unified runner migration (`20260518.01.unified-runner-migration`)
- Prior session: Connect MCP Server Workflow port (discover → classify pipeline)
- Prior session: Discover MCP Server activity port

---

**Status**: Production Ready
**Timeline**: ~30 minutes
