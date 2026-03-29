# StatusBuilder Hardening: T02 Research — tool_call_id Availability on LangGraph Events

**Date**: March 29, 2026

## Summary

Completed T02 research for the StatusBuilder hardening project by tracing the LangGraph/LangChain event pipeline across 5 framework layers. Confirmed that v2 `on_tool_start` events do NOT expose the model's `tool_call_id`, but discovered that a lightweight `BaseCallbackHandler` captures it universally for all tools. This finding unblocks T04 (fingerprint dedup elimination) and renders the `InjectedToolCallId` coverage question irrelevant.

## Problem Statement

StatusBuilder uses a SHA256 fingerprint dedup system (~3 dictionaries, ~100 lines) to match tool events across fresh/resume execution cycles. This exists because the codebase didn't have a way to obtain the model's `tool_call_id` (the Anthropic `toolu_*` ID) from LangGraph v2 stream events. Before any code changes could eliminate this compensating complexity, the T02 research question had to be answered: is `tool_call_id` available on v2 events, and if not, how can StatusBuilder obtain it?

### Pain Points

- Fingerprint dedup is fragile — `_humanize_args_for_display` transforms values before storage, causing fingerprints computed from raw event args vs. display args to diverge
- FIFO fallback (`_reconciled_resume_tool_calls`) compensates for fingerprint divergence, adding another matching heuristic
- `_run_id_aliases` bridges the gap between LangGraph's fresh `run_id` and the original `tool_call_id`, requiring a reconciliation layer
- All of this is compensating complexity for one missing identity: the model's `tool_call_id` on tool events

## Solution

A ~10-line `ToolCallIdCapture` callback handler using LangChain's `BaseCallbackHandler` API. The callback system receives `tool_call_id` as a kwarg on `on_tool_start` for every tool invoked through ToolNode — regardless of whether the tool uses `InjectedToolCallId`. The handler stores a `{run_id -> tool_call_id}` mapping that StatusBuilder reads when processing the corresponding v2 event.

## Research Trace (5 Framework Layers)

| Layer | Component | What happens to tool_call_id |
|-------|-----------|------------------------------|
| 1 | **ToolNode** (LangGraph) | Builds ToolCall dict with `id` from AIMessage, calls `tool.invoke()` |
| 2 | **BaseTool._prep_run_args** (LangChain) | Extracts `tool_call_id = value["id"]` from the dict |
| 3 | **BaseTool._filter_injected_args** | Strips injected args from callback inputs — `data.input` never contains `tool_call_id` |
| 4 | **CallbackManager.on_tool_start** | Receives `tool_call_id` as a **separate kwarg** (not in `inputs`) |
| 5 | **_AstreamEventsCallbackHandler** | Stores `tool_call_id` in internal `RunInfo` but does NOT include it in the emitted v2 event |

The callback handler intercepts at Layer 4 — the same level where the framework receives the identity — and stores it before the v2 event is yielded.

## Key Surprise

The original hypothesis was that adding `InjectedToolCallId` to all tool wrappers would make `tool_call_id` appear in `event["data"]["input"]`. This is wrong. `_filter_injected_args` (langchain_core/tools/base.py:803-828) deliberately strips all injected args before passing to callbacks. The callback handler approach is necessary regardless — and is superior because it works for ALL tools without any per-wrapper changes.

## Impact on StatusBuilder (T04 scope)

With `{run_id -> tool_call_id}` available, the following can be deleted:

| What | Type | Purpose |
|------|------|---------|
| `tool_call_fingerprints` | set | SHA256 dedup of tool args |
| `_fingerprint_to_tool_call_id` | dict | fingerprint -> tool_call.id |
| `_reconciled_resume_tool_calls` | dict[str, deque] | FIFO per tool name for resume fallback |
| `_get_tool_fingerprint()` | method | SHA256(name + sorted JSON args) |
| Fingerprint logic in `populate_fingerprints_from_existing_tool_calls()` | method (partial) | Index rebuild stays, fingerprint parts go |
| Lines 773-824 in `_handle_tool_start_event` | logic | 50-line fingerprint check + FIFO fallback -> 3-line identity lookup |

## Benefits

- **Identity-based dedup**: Direct `tool_call_id` lookup replaces SHA256 fingerprints, FIFO queues, and name-based matching
- **Universal coverage**: Works for ALL tools — MCP, platform, approval-wrapped — without modifying any tool wrapper
- **Framework-sanctioned**: `BaseCallbackHandler` is the standard LangChain extension point, not a hack
- **Timing-safe**: Sync callback fires before async v2 event is yielded, guaranteeing the mapping exists when StatusBuilder processes the event

## Related Work

- Project: `_projects/2026-03/20260329.02.status-builder-hardening/`
- Research document: `tasks/T02_0_research.md`
- Plan: `tasks/T01_0_plan.md`
- Next: T03 (namespace injection feasibility), T04 (fingerprint dedup elimination — unblocked)

---

**Status**: ✅ Research Complete (no code changes — findings only)
**Timeline**: ~1 hour (framework trace, code reading, documentation)
