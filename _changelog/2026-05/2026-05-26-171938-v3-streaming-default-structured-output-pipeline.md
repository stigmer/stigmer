# v3 Streaming Default + Structured Output Pipeline

**Date**: May 26, 2026

## Summary

Made v3 the default streaming protocol for all ExecuteDeepAgent executions and wired the structured output pipeline end-to-end. `run.output.structuredResponse` now flows into both the gRPC-persisted `AgentExecutionStatus.structured_output` field and the Temporal activity result, closing the pipeline gap that left frontend and API subscribers seeing nil structured output.

## Problem Statement

The structured output pipeline had a gap: `structuredResponse` extracted from v3's `run.output` was only placed in the Temporal activity return (`slim.structured`) but never set on the proto status before `persistStatus()`. This meant:

### Pain Points

- Frontend and API queries via gRPC received nil `structured_output` even when the agent produced valid structured data
- The v3 streaming path (which provides `run.output`) was gated behind an opt-in env var, defaulting to the legacy v2 path that cannot extract structured output at all
- Conditional routing logic based on `hasStructuredOutput` was planned, which would have created two active code paths in production and increased maintenance burden

## Solution

Two surgical changes:
1. Flip the streaming version default: v3 is now the default protocol, v2 is the explicit escape hatch (`LANGGRAPH_STREAM_EVENTS_VERSION=v2`)
2. Set `initialStatus.structuredOutput` from `run.output.structuredResponse` before calling `persistStatus()`, populating both pipeline channels atomically

## Implementation Details

**`setup.ts` (1 line):** Inverted the conditional — `LANGGRAPH_STREAM_EVENTS_VERSION` defaults to `"v3"`, only falls back to `"v2"` when explicitly set.

**`index.ts` (net -15 lines):**
- Added `JsonObject` type import from `@bufbuild/protobuf`
- Replaced verbose extraction logic with a single defensive check: verify `structuredResponse` is a non-null, non-array object before assigning to proto
- Set `initialStatus.structuredOutput = structuredOutput` before `persistStatus()` — the server-side `update_status.go` merge logic already handles the field
- Removed dead v2-specific warning log and redundant comments

## Benefits

- **Both pipeline channels populated**: gRPC subscribers (frontend, workflow callbacks) AND Temporal activity result now receive structured output atomically
- **Simpler code**: 15 lines removed, no conditional streaming-protocol routing based on feature usage
- **Single streaming path in production**: v3 for all executions eliminates dual-path divergence risk
- **Phase 4 absorbed**: "Full Streaming Parity" is no longer a separate phase since v3 is default for everything

## Impact

- **Runner**: All agent executions now use v3 streaming by default
- **Frontend**: `structured_output` field on `AgentExecutionStatus` will be populated for structured output runs (previously always nil via gRPC query)
- **Workflows**: `buildCallbackResult` still reads from activity result (`slim.structured`) as before — now also has the gRPC fallback path working
- **Deployment**: Zero-config — v3 activates automatically. Escape hatch is `LANGGRAPH_STREAM_EVENTS_VERSION=v2` env var.

## Related Work

- Part of the v3 streaming migration project (`_projects/2026-05/20260525.01.v3-streaming-migration`)
- Builds on Phase 2 (V3StatusBuilder + V3ProtocolNormalizer, Session 7)
- Proto field `structured_output` defined in `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (field 21)
- Server merge logic in `backend/services/stigmer-server/pkg/domain/agentexecution/controller/update_status.go`

---

**Status**: Production Ready
**Timeline**: 1 session (Phase 3 of v3 migration)
