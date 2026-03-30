# execute_graphton T01 Quick Wins — Error Dedup, InlinePublisher, Recursion Limit

**Date**: March 30, 2026

## Summary

Reduced `execute_graphton.py` by 57 lines (2,184 → 2,127) through three independent, low-risk structural extractions: deduplicated error-handling persistence, extracted the inline-publish closure into a testable class, and replaced a magic number with a named constant. All 1,382 existing tests pass unchanged. This is the first task of the execute-graphton simplification project, preparing for the larger SetupOrchestrator extraction (T04).

## Problem Statement

`execute_graphton.py` is a 2,184-line Temporal activity — the critical runtime path for all agent executions. While a prior project confirmed the code is architecturally correct (event handlers, streaming buffers, and checkpoint validation are a necessary product-level projection layer, not LangGraph duplication), it has structural issues that hinder maintainability:

### Pain Points

- Two large error handlers (42 + 98 lines) with nearly identical gRPC persistence patterns — 140 lines of code with a single shared concern duplicated
- A 64-line closure capturing 6 variables from the enclosing scope — untestable in isolation, obstructing function readability
- A magic number `10_000_000` used as the "unlimited" recursion sentinel — undocumented intent, easy to misunderstand

## Solution

Three independent, zero-behavioral-change structural extractions, each addressing a specific code smell:

1. **S5 — Named constant**: Replaced inline `10_000_000` with `_LANGGRAPH_UNLIMITED_RECURSION` module-level constant
2. **S3 — Error dedup**: Extracted `_persist_and_return_failed_status()` async helper to unify gRPC persistence across both error handlers
3. **S4 — InlinePublisher**: Extracted the publish closure into a `InlinePublisher` class in its own module with explicit constructor dependencies

## Implementation Details

### S5: Recursion Limit Named Constant

Added `_LANGGRAPH_UNLIMITED_RECURSION = 10_000_000` at module level. The original plan proposed also removing `recursion_limit` from the `create_deep_agent()` call, but analysis revealed graphton uses it for `ExecutionBudgetMiddleware` configuration (threshold mode vs periodic mode). Removing it would have changed budget-warning behavior — a behavioral change the plan prohibited. The pass-through was kept intact.

### S3: Error Handling Deduplication

Extracted `_persist_and_return_failed_status()` — a module-level async helper that accepts an already-built `AgentExecutionStatus`, an optional `execution_client`, and an optional `retry_executor`. It handles the three gRPC exception types (`GrpcRetryExhaustedError`, `GrpcNonRetryableError`, generic `Exception`) and returns `_slim_status_for_temporal()`. Both the outer system-error handler and the inner execution-error handler now delegate persistence to this single helper while keeping their meaningfully-different status-building logic.

### S4: InlinePublisher Extraction

Created `worker/activities/graphton/inline_publisher.py` with an `InlinePublisher` class. The 6 closure-captured variables became explicit constructor parameters. The 64-line closure was replaced with an 8-line instantiation. 9 new unit tests cover path normalization (with/without `_normalize`), artifact registration on `status_builder`, and error swallowing.

## Benefits

- **-57 net lines** from execute_graphton.py (115 insertions, 168 deletions across the file)
- **Testability**: InlinePublisher is independently testable (9 new tests) — the closure was not
- **Readability**: Both error handlers are now ~20-35 lines instead of 42-98
- **Named intent**: `_LANGGRAPH_UNLIMITED_RECURSION` documents the sentinel's purpose
- **Preparation**: Smaller function body makes the T04 SetupOrchestrator extraction safer

## Impact

- **Files modified**: 2 (`execute_graphton.py`, `graphton/__init__.py`)
- **Files created**: 2 (`inline_publisher.py`, `test_inline_publisher_class.py`)
- **Tests**: 1,382 pass (1,373 existing + 9 new), zero failures
- **Behavioral changes**: None — pure structural refactoring
- **Runtime path**: Agent execution, error handling, artifact publishing — all unchanged

## Related Work

- Predecessor: [status-builder-hardening](../2026-03/2026-03-29-status-builder-hardening/) (StatusBuilder 3,289 → 417 lines)
- Project: `_projects/2026-03/20260330.01.execute-graphton-simplification/`
- Next: T02 (LangGraph v2 tool_call_id research), T03 (HITL fallback elimination), T04 (SetupOrchestrator extraction)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
