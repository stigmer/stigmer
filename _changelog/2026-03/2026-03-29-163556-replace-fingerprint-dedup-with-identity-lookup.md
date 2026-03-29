# Replace Fingerprint Dedup with Identity-Based Lookup (T04)

**Date**: March 29, 2026

## Summary

Replaced the SHA256 fingerprint deduplication system in StatusBuilder with identity-based lookup using a `ToolCallIdCapture` callback handler. This eliminates 3 dictionaries, 2 methods, and ~100 lines of fragile heuristic matching from the resume-after-approval path, replacing it with ~15 lines of direct framework-provided identity resolution.

## Problem Statement

The resume-after-approval path in StatusBuilder used a multi-layered heuristic matching system to prevent duplicate tool calls when LangGraph re-fires `on_tool_start` events with fresh `run_id`s:

### Pain Points

- **SHA256 fingerprint matching** computed from tool name + JSON-sorted args was fragile — humanized display args diverged from raw event args, causing mismatches
- **FIFO correlation queue** (`_reconciled_resume_tool_calls`) existed solely to compensate for fingerprint failures, adding a second matching heuristic
- **Three dictionaries** (`tool_call_fingerprints`, `_fingerprint_to_tool_call_id`, `_reconciled_resume_tool_calls`) tracked overlapping state with lifecycle management obligations
- **60+ lines of branching logic** in `_handle_tool_start_event` for two dedup paths (fingerprint check → FIFO fallback) obscured the straightforward intent: "is this tool call already known?"

## Solution

Leverage the LangChain callback API, which provides the model's stable `tool_call_id` (e.g. `toolu_01abc…`) on `on_tool_start` — unlike the v2 stream events which do not. A focused `ToolCallIdCapture(BaseCallbackHandler)` captures `{run_id → tool_call_id}` as tools start, and StatusBuilder uses this direct identity to look up existing tool calls in its index.

## Implementation Details

**New module**: `tool_call_id_capture.py` (~45 lines)
- `ToolCallIdCapture(BaseCallbackHandler)` with a single `on_tool_start` override
- Stores `{str(run_id): tool_call_id}` mapping from the callback API
- `.get(run_id)` convenience method for StatusBuilder

**Wiring** (`execute_graphton.py`):
- `ToolCallIdCapture` instance created before StatusBuilder
- Passed to StatusBuilder as constructor parameter
- Added to LangGraph config's `callbacks` key

**StatusBuilder simplification** (`status_builder.py`, net -197 lines):
- Deleted 3 dictionaries: `tool_call_fingerprints`, `_fingerprint_to_tool_call_id`, `_reconciled_resume_tool_calls`
- Deleted `_get_tool_fingerprint()` method and `hashlib`/`deque` imports
- Replaced 60-line fingerprint+FIFO dedup with ~15-line identity lookup in `_handle_tool_start_event`
- Removed fingerprint writes from `_reconcile_early_tool_call`
- Renamed `populate_fingerprints_from_existing_tool_calls` → `rebuild_index_from_persisted_status` (retains only index rebuild)

**HITL cleanup** (`hitl.py`):
- Renamed method call, deleted FIFO queue population block, updated logging and docstrings, removed `deque` import

**Test updates** (`test_status_builder.py`, `test_hitl_contracts.py`):
- Rewrote 4 alias tests to use `ToolCallIdCapture` instead of fingerprint dedup
- Deleted 4 fingerprint-specific tests and 1 FIFO-specific test class
- Updated ~8 tests with renamed method calls

## Benefits

- **Correct by construction**: Framework-provided identity cannot diverge like computed fingerprints
- **Simpler code**: 1 lookup replaces 2 heuristic paths with 3 supporting dictionaries
- **Net deletion**: -197 lines across production and test code
- **No proto changes**: Zero impact on persistence, gRPC, or downstream consumers
- **Idempotent**: Same `(run_id, tool_call_id)` processed twice produces the same alias — no state accumulation

## Impact

- **StatusBuilder**: Meaningfully simpler `_handle_tool_start_event` — the most complex event handler in the system
- **Resume path**: More reliable dedup; no more mismatches from humanized vs. raw arg divergence
- **Maintainability**: 3 fewer dictionaries with lifecycle obligations on a 3,500+ line class
- **Test suite**: All 1,375 tests pass; 4 fragile fingerprint-specific tests replaced with identity-based equivalents

## Related Work

- **T02 Research** (`tasks/T02_0_research.md`): Proved `tool_call_id` availability via callback API; designed the `ToolCallIdCapture` approach
- **T07 (planned)**: Will fold `_run_id_aliases` into the capture handler or eliminate it entirely as part of the ExecutionState refactor

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~1 hour)
