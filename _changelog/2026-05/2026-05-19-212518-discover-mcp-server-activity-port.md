# Port DiscoverMcpServerCapabilities Activity to Unified TypeScript Runner

**Date**: May 19, 2026

## Summary

Ported the `DiscoverMcpServerCapabilities` Temporal activity from the Python agent-runner to the unified TypeScript runner, completing the third of five activities in the Phase 4 supporting activities migration. The activity connects to an MCP server, enumerates its tools and resource templates, and returns a serializable result used by the `ConnectMcpServerWorkflow` to decide whether tool classification needs to run.

## Problem Statement

The MCP server discovery activity was implemented only in Python, requiring the Python agent-runner to remain deployed for the `stigmer/mcp-server/connect` workflow to function. This blocked the migration goal of eliminating Python from the agent execution path.

### Pain Points

- Python agent-runner required for MCP discovery even though the rest of the connect workflow was being migrated
- No TypeScript implementation of tool enumeration, resource template listing, or tools fingerprinting
- Platform env injection logic (`STIGMER_SERVER_ADDRESS` mapping) only existed in Python

## Solution

Implemented a clean TypeScript port following the established activity factory pattern, with a pure core function for testability and full reuse of existing shared infrastructure (MCP resolver, MCP manager, placeholder resolver, StigmerClient).

## Implementation Details

**New files:**

- `src/activities/discover-mcp-server.ts` (~300 lines) — types, core logic, factory
- `src/activities/__tests__/discover-mcp-server.test.ts` (~380 lines) — 27 tests

**Modified files:**

- `src/shared/mcp-resolver.ts` — exported `mcpServerToResolved()` (was private)
- `src/main.ts` — registered `DiscoverMcpServerCapabilities` activity

**Key design decision:** Uses `MultiServerMCPClient` from `@langchain/mcp-adapters` for transport setup (stdio subprocess, streamable HTTP), then `getClient(slug)` to access the raw MCP SDK `Client` for `listTools()` and `listResourceTemplates()`. This preserves the original JSON Schema `inputSchema` which would be lost through LangChain's `DynamicStructuredTool` wrapping.

**Activity capabilities:**
- Fetches MCP server spec via gRPC
- Resolves environment variables from pre-created ExecutionContext (secret-safe: only IDs in Temporal history)
- Injects platform infrastructure env vars (`STIGMER_SERVER_ADDRESS` from runner's `STIGMER_MCP_PUBLIC_ENDPOINT`)
- Connects to MCP server with 270s timeout and descriptive cold-start error messages
- Enumerates tools and resource templates (resource templates only when capabilities indicate support)
- Computes deterministic SHA-256 fingerprint of previous tools for connect workflow short-circuit
- Extracts previous tool approval policies from server status

## Benefits

- Unified runner now handles 5 of 5 activities: `ExecuteCursor`, `ExecuteDeepAgent`, `EnsureThread`, `ClassifyToolApprovals`, `DiscoverMcpServerCapabilities`
- Zero new dependencies — reuses existing `@langchain/mcp-adapters` and shared modules
- 27 new tests covering factory registration, fingerprinting, previous state extraction, core discovery flow, error handling, and idle watchdog integration
- 403 total tests passing, typecheck clean

## Impact

- **Unified Runner**: All Temporal activities for the connect workflow are now available in TypeScript
- **Migration**: Unblocks the `ConnectMcpServerWorkflow` port (next task), which is the last piece before the Python agent-runner's MCP connect path can be retired
- **Testing**: Comprehensive test coverage for all discovery scenarios including timeout, missing specs, resource template graceful degradation

## Related Work

- [Phase 4 ClassifyToolApprovals port](2026-05-19-174302-fga-authorization-redesign-blueprint-instance-execution.md) — the downstream activity in the connect workflow
- ConnectMcpServerWorkflow (upcoming) — the Temporal workflow that orchestrates discover → classify

---

**Status**: Production Ready
**Timeline**: 1 session
