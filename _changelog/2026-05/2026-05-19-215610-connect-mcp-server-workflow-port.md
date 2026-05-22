# Port ConnectMcpServerWorkflow to Unified TypeScript Runner

**Date**: May 19, 2026

## Summary

Ported the `ConnectMcpServerWorkflow` and legacy `DiscoverMcpServerWorkflow` from the Python agent-runner to the unified TypeScript runner, introducing the first Temporal workflow to the TS worker. The workflow orchestrates MCP server capability discovery followed by LLM-based tool approval classification, with a fingerprint-based short-circuit to skip reclassification when tools haven't changed.

## Problem Statement

The MCP server connect flow (`stigmer/mcp-server/connect`) was implemented as a Python Temporal workflow that chained two activities: `DiscoverMcpServerCapabilities` and `ClassifyToolApprovals`. Both activities had already been ported to TypeScript in prior sessions, but the orchestrating workflow that ties them together remained in Python.

### Pain Points

- The Python workflow was the last piece blocking the connect flow from running entirely in the TypeScript runner
- Activities were ported but couldn't be exercised as a workflow without the orchestrator
- The unified runner registered only activities — no workflow handling capability

## Solution

Created a complete Temporal workflow implementation in TypeScript with three key architectural decisions to handle the differences between Python and TypeScript Temporal SDKs:

1. **Sandbox-safe fingerprint computation**: Moved `toolsFingerprint()` computation from the workflow to the activity, since the Temporal TS sandbox blocks `node:crypto`
2. **Snake_case boundary adapter**: Workflow boundary types use snake_case matching the Java wire format; the workflow maps to/from camelCase activity types
3. **ES2022 string-named exports**: Used `export { fn as "stigmer/mcp-server/connect" }` to map TypeScript function names to the slash-delimited Temporal workflow type names that the Java backend expects

## Implementation Details

### New Files

- **`src/workflows/types.ts`** (~65 lines) — Snake_case boundary interfaces matching the Java `Map<String, Object>` wire format: `ConnectMcpServerWorkflowInput`, `ConnectMcpServerWorkflowOutput`, wire-format nested types
- **`src/workflows/connect-mcp-server.ts`** (~135 lines) — Two workflow functions: `connectMcpServer()` (discover → fingerprint short-circuit → classify) and `discoverMcpServerLegacy()` (backward compat wrapper)
- **`src/workflows/index.ts`** (~20 lines) — Barrel file re-exporting with Temporal workflow type names via ES2022 arbitrary module export syntax
- **`src/workflows/__tests__/connect-mcp-server.test.ts`** (~290 lines) — 12 tests covering happy path, fingerprint short-circuit (4 variants), error propagation, wire format correctness, and legacy workflow

### Modified Files

- **`src/activities/discover-mcp-server.ts`** — Added `newToolsFingerprint` field to `DiscoverMcpServerOutput`, computed in the activity before returning
- **`src/worker.ts`** — Added `workflowsPath` pointing to the workflow barrel file via ESM-compatible `fileURLToPath` + `import.meta.url`
- **`package.json`** — Added `@temporalio/workflow` (runtime) and `@temporalio/testing` (dev)

### Workflow Logic

The `connectMcpServer` workflow mirrors the Python `ConnectMcpServerWorkflow.run()` exactly:

1. Call `DiscoverMcpServerCapabilities` activity (600s timeout, 60s heartbeat, 1 attempt)
2. Compare `newToolsFingerprint` with `previousToolsFingerprint`
3. If fingerprint unchanged AND previous approvals exist → reuse (short-circuit, no LLM call)
4. Otherwise → call `ClassifyToolApprovals` activity (dynamic timeout based on tool count, 2 attempts)
5. Return combined output in snake_case wire format for Java backend consumption

## Benefits

- The connect flow (`stigmer/mcp-server/connect`) can now run entirely in the TypeScript runner
- The unified runner handles both workflow and activity tasks on a single Temporal queue
- Fingerprint short-circuit avoids unnecessary LLM classification calls when tools haven't changed
- The wire format boundary adapter pattern is documented and tested, establishing the convention for future cross-language workflow ports

## Impact

- **Unified runner**: Now registers 5 activities + 2 workflows (up from activities only)
- **Test suite**: 417 tests passing across 38 files (14 new tests added)
- **Phase 4 progress**: ConnectMcpServerWorkflow is the final critical-path item before Phase 5 (Testing)

## Related Work

- [Discover MCP Server Activity Port](2026-05-19-212518-discover-mcp-server-activity-port.md) — Activity ported in Session 11
- [Classify Tool Approvals Activity Port](2026-05-19-204647-classify-tool-approvals-activity-port.md) — Activity ported in Session 10
- [Unified Runner Service Scaffold](2026-05-19-112647-unified-runner-service-scaffold.md) — Phase 1 foundation

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
