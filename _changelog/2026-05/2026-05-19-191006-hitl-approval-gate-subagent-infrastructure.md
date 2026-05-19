# HITL Approval Gate and Sub-Agent Infrastructure (Phase 3c)

**Date**: May 19, 2026

## Summary

Implemented the human-in-the-loop (HITL) approval flow and sub-agent infrastructure for the unified TypeScript runner's `ExecuteDeepAgent` activity. This gives deep agents the same tool approval, interrupt/resume, and sub-agent concurrency controls that existed in the Python agent-runner, completing the production control surface for ExecuteDeepAgent.

## Problem Statement

The unified TypeScript runner had a complete streaming pipeline (StatusBuilder, middleware stack, artifact storage, writeback) from Phase 3b, but lacked the HITL approval flow. Without it, every tool call would execute unconditionally — no user consent for dangerous operations, no sub-agent concurrency limits, and no budget controls for delegated work.

### Pain Points

- ExecuteDeepAgent could not pause for user approval on sensitive tool calls
- No mechanism to resume execution after approval decisions were submitted
- Sub-agents had no concurrency limits — could exhaust resources
- Sub-agents had no per-agent budget controls or cost cap sharing
- Platform tools (write, delete, execute) had no default approval requirements

## Solution

Three-part implementation matching the Python Graphton reference:

1. **Approval Gate Middleware** — A `wrapToolCall` middleware that checks merged policies and calls LangGraph `interrupt()` for tools requiring approval. Includes platform tool defaults (safe: read/glob/grep; dangerous: write/edit/delete/execute).

2. **HITL Resume Infrastructure** — DB-driven resume that reads approval decisions from persisted execution status, matches them to LangGraph checkpoint interrupts, and builds `Command(resume={...})` payloads.

3. **Sub-Agent Infrastructure** — Promise-based semaphore (max 3 concurrent), per-sub-agent middleware composition with periodic budget advisories, and shared cost cap via `forSubAgent()`.

## Implementation Details

### New Modules

| Module | Lines | Purpose |
|--------|-------|---------|
| `middleware/approval-gate.ts` | ~150 | Policy checks + `interrupt()` + platform defaults |
| `activities/execute-deep-agent/hitl.ts` | ~190 | Resume resolution + `Command(resume)` builder |
| `shared/subagent-gate.ts` | ~80 | Promise-based concurrency semaphore |
| `activities/execute-deep-agent/subagent-wiring.ts` | ~55 | Per-sub-agent middleware composition |

### Design Decisions

- **DD-8**: Middleware-based approval (not per-tool wrapping) — all execution controls stay in the middleware stack
- **DD-9**: Platform tool defaults included — safe tools auto-approved, dangerous tools gated
- **DD-10**: Custom summarization deferred to Phase 4 — independent from HITL

### Key Patterns

- **DB-driven resume**: Approval decisions read from persisted execution status (`client.getExecution()`), not Temporal activity arguments. Matches Go workflow contract.
- **Non-blocking sub-agent rejection**: `SubAgentGate` returns error-shaped messages when at capacity rather than queuing. LLM adapts its plan.
- **Idempotent interrupt**: LangGraph restarts the node on resume; `interrupt()` returns the decision value on replay without re-pausing.

## Benefits

- ExecuteDeepAgent now has feature parity with the Python agent-runner's HITL controls
- 38 new tests (341 total) with full coverage of approval, resume, and concurrency paths
- Clean middleware-based architecture — approval is just another middleware in the stack
- Sub-agent infrastructure is ready for when sub-agents are wired in `setup.ts`

## Impact

- **Runner service**: 4 new files, 5 new test files, 7 modified files
- **Test suite**: 303 → 341 tests (all passing)
- **Typecheck**: Clean
- **Phase 3c**: Complete — Phase 4 (Supporting Activities) is next

## Related Work

- Phase 3b-i: StatusBuilder + streaming (session 5)
- Phase 3b-ii: Production middleware stack (session 6)
- Phase 3b-iii: Artifact storage + writeback (session 7)
- Next: Phase 4 — EnsureThread, MCP discovery, multi-provider models, summarization verification

---

**Status**: Production Ready
**Timeline**: 1 session (Phase 3c)
