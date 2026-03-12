# Fix Loop Detection Middleware: Revive Dead Code with Two-Hook Architecture

**Date**: March 12, 2026

## Summary

The `LoopDetectionMiddleware` in graphton was entirely non-functional — all detection logic lived in `aafter_step()`, a method that does not exist in LangChain's `AgentMiddleware` base class and was never invoked. This change replaces the dead code with a two-hook architecture using `aafter_model` (detection + intervention) and `awrap_tool_call` (enforcement), making loop detection operational for the first time.

## Problem Statement

During the production incident analysis of execution `aex-01kkg22yeeez6579b8mcaz5bwt`, the agent completed its task at ~step 30-40, then autonomously started a second improvement pass — re-reading its own output, launching 6+ sub-agents, and eventually crashing with a context overflow at 249,324 tokens.

### Pain Points

- `LoopDetectionMiddleware` implemented all detection in `aafter_step()`, which is not a valid `AgentMiddleware` hook
- `abefore_agent()` fired once and cleared state (correct), but `aafter_step()` was never called, so no tool calls were ever tracked
- `aafter_agent()` logged final stats that were always zeros — creating false confidence that loop detection was active
- The configured thresholds (`consecutive_threshold=7`, `total_threshold=20`) were never evaluated
- Combined with the 10x recursion limit inflation (fixed in prior PR3), this meant agents had 1,000 cycles with zero behavioral guardrails

## Solution

Replaced the dead `aafter_step` hook with two complementary hooks from the `AgentMiddleware` API:

**`aafter_model` — Detection and intervention**: Fires after every model call. Inspects the AIMessage's `tool_calls`, tracks signatures in a sliding window, and injects SystemMessage interventions when repetitive patterns are detected.

**`awrap_tool_call` — Enforcement at hard stop**: Wraps every tool execution. When the total threshold is exceeded, short-circuits by returning a ToolMessage without calling the handler, preventing wasted computation.

## Implementation Details

### Hook Architecture

The two-hook design was chosen over a single `aafter_model` approach after discovering that `aafter_model` cannot prevent tool execution for the current turn. The routing edge (`_make_model_to_tools_edge`) determines next steps by extracting the last AIMessage from state, not the last message — so a SystemMessage injected by `aafter_model` does not affect routing.

For warnings, this is acceptable (the model sees the warning on its next invocation). For the hard stop at `total_threshold`, `awrap_tool_call` provides true enforcement by intercepting each tool call and returning a "halted" ToolMessage without executing the tool.

### State Management

- `_tool_history`: Fixed-size `deque` tracking `(tool_name, param_hash)` signatures
- `_intervention_count`: Number of intervention messages injected (warning + stop)
- `_stopped`: Boolean flag shared between `aafter_model` (sets it) and `awrap_tool_call` (reads it)
- All state cleared by `abefore_agent` at the start of each execution

### Key Design Decisions

1. **Remove `aafter_step` entirely** — It was never functional. Keeping it as "deprecated" would imply it once worked.
2. **Return `{"messages": [intervention]}` not `{"messages": state["messages"]}`** — The `add_messages` reducer appends; returning only the new message is cleaner and avoids re-processing the full message list.
3. **Logging uses `%`-style formatting** — Consistent with Python logging best practices (lazy evaluation, no wasted string construction).

### Test Coverage

Created `tests/core/test_loop_detection.py` with 46 tests across 10 classes:
- Internal helpers: hash stability, consecutive detection, total detection
- Hook integration: `aafter_model` tracking, warning injection, stop injection
- Enforcement: `awrap_tool_call` passthrough vs blocking
- Lifecycle: `abefore_agent` reset, `aafter_agent` stats
- Edge cases: threshold=1, history eviction, disabled middleware, state immutability
- Full lifecycle: end-to-end warning → stop → tool blocking

### Factory Registration Verified

LangGraph's `create_agent` factory automatically detects overridden hooks by comparing `m.__class__.aafter_model is not AgentMiddleware.aafter_model`. Both `aafter_model` and `awrap_tool_call` are correctly detected and will be wired as graph nodes.

## Benefits

- **Loop detection is operational** for the first time — agents that enter repetitive patterns will receive intervention messages and have tool execution blocked at the hard stop threshold
- **No wasted computation** at hard stop — `awrap_tool_call` prevents expensive tools (sub-agent launches, API calls) from executing after the total threshold is exceeded
- **Clean separation** — detection (what happened?) and enforcement (what to do about it?) are in separate hooks with a simple `_stopped` flag bridging them
- **Comprehensive test coverage** — 46 tests covering every code path, edge case, and the full lifecycle

## Impact

- **Graphton library** (`backend/libs/python/graphton`) — core middleware component
- **All agent executions** — loop detection is auto-injected by `create_deep_agent()` for every agent
- **Production safety** — prevents the class of runaway self-improvement loops observed in the incident

## Related Work

- PR3 (Recursion Limit Fix) — already merged, reduced limit from 1000 to 100
- PR2 (Mid-Execution Summarization) — next in sequence, addresses context overflow via `aafter_model` in `ContextSummarizationMiddleware`
- Design decision `001-recursion-limit-value.md` — documents the 100 limit rationale

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
