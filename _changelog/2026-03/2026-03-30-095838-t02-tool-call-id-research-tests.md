# T02 Research: tool_call_id Availability on LangGraph v2 Events

**Date**: March 30, 2026

## Summary

Empirically verified through 12 test cases that LangGraph v2 `astream_events` does NOT expose `tool_call_id` on tool start/end events, while the LangChain callback API continues to deliver it. This validates the `ToolCallIdCapture` architecture and unblocks T03 (HITL bidirectional fallback elimination) with confidence.

## Problem Statement

The `ToolCallIdCapture` class in the agent-runner bridges a gap between LangGraph's v2 streaming events and the LangChain callback API. The initial analysis claimed v2 events lack `tool_call_id`, but this was based on observation, not verified tests. T03 (eliminating the bidirectional fallback matching heuristic) depends on confirming that the primary identity path through `ToolCallIdCapture` is sound.

### Pain Points

- No empirical verification that `tool_call_id` is absent from v2 events
- No tests proving the callback API ordering guarantee (callbacks must fire before v2 events)
- No tests covering the resume-after-interrupt path with `tool_call_id` preservation
- T03's safety depended on an unverified assumption

## Solution

Created a comprehensive test suite following the established pattern of `test_native_subgraph_interrupt.py` -- deterministic LangGraph graphs with no LLM API key required, plus optional real-model verification.

## Implementation Details

**File**: `backend/libs/python/graphton/tests/core/test_tool_call_id_on_events.py`

**6 test classes, 12 tests:**

| Class | Tests | Key Finding |
|-------|-------|-------------|
| `TestToolCallIdOnV2StreamEvents` | 3 | v2 events lack `tool_call_id` at envelope level |
| `TestToolCallIdOnCallbackApi` | 2 | Callback receives `tool_call_id`, matches AIMessage id |
| `TestCallbackFiresBeforeStreamEvent` | 1 | Sync callbacks fire before v2 event yield |
| `TestToolCallIdWithMultipleToolCalls` | 2 | Each tool call gets correct id via callback |
| `TestToolCallIdOnResumeAfterInterrupt` | 2 | Resume preserves original `tool_call_id` |
| `TestToolCallIdWithRealLLM` | 2 | Real Anthropic model confirms (skipped without key) |

**Test approach**: Deterministic graph with a "model" node that emits `AIMessage` with known `tool_calls[].id` values, `ToolNode` executing `@tool` functions, `MemorySaver` for interrupt/resume tests. No mock frameworks needed -- pure LangGraph execution.

## Benefits

- Empirical proof replaces assumption -- T03 can proceed with confidence
- Tests serve as living documentation of LangGraph's event structure
- Future LangGraph version upgrades will automatically detect if `tool_call_id` gets added to v2 events (tests would fail with "SURPRISE" messages, prompting ToolCallIdCapture simplification)
- Real-LLM tests provide belt-and-suspenders verification when API key is available

## Impact

- **T03**: Unblocked -- the bidirectional fallback in HITL matching is confirmed as compensating complexity, not a necessary safety net
- **ToolCallIdCapture**: Validated as architecturally correct and necessary for the current LangGraph version
- **Future engineers**: Clear test-documented evidence of why ToolCallIdCapture exists

## Related Work

- Part of [20260330.01.execute-graphton-simplification](../_projects/2026-03/20260330.01.execute-graphton-simplification/) project
- Follows [T01 quick wins](2026-03-30-095047-execute-graphton-t01-quick-wins.md) in the same project
- Tested against: `langgraph==1.0.8`, `langchain-core==1.2.12`

---

**Status**: Complete
**Timeline**: ~30 minutes (research + test writing + verification)
