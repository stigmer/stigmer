# Handler Extraction — StatusBuilder Below 500 Lines (T08)

**Date**: March 29, 2026

## Summary

Extracted all event-processing logic from the 3,289-line `StatusBuilder` god object into six focused handler modules under `graphton/handlers/`, reducing `StatusBuilder` to a 417-line thin orchestrator that dispatches events and delegates to cohesive handler functions. This is the capstone refactoring step in the status-builder-hardening project, transforming a monolithic class into a maintainable, modular architecture.

## Problem Statement

After T07 (ExecutionState extraction), `StatusBuilder` still contained ~2,800 lines of event-handling logic: tool lifecycle management, chat model streaming, sub-agent orchestration, context tracking, and content formatting. The sheer size made it difficult to reason about any single concern, and the class violated the single-responsibility principle at every level.

### Pain Points

- 2,800+ lines of mixed concerns in a single class — tool events, chat model events, sub-agent lifecycle, streaming buffers, context info, and formatting utilities all interleaved
- Developers had to scan thousands of lines to understand any one event handler
- Test failures were hard to localize — a change to formatting could break tool event tests
- Adding new event types required modifying the god object rather than adding a focused module
- Code review burden: every PR touching StatusBuilder was a multi-thousand-line context load

## Solution

Extract cohesive groups of event-handling logic into module-level functions within a `graphton/handlers/` subpackage. Each handler module receives the `StatusBuilder` instance (`sb`) as its first argument, keeping the pattern simple and avoiding premature abstraction. `StatusBuilder` retains thin delegation methods for public API compatibility and test mock targets.

## Implementation Details

### New Handler Modules (2,576 lines total)

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `formatting.py` | 193 | Stateless content extraction: tool results, thinking blocks, command content, arg unwrapping |
| `streaming_buffers.py` | 538 | AI message creation, early tool-call tracking, thinking/tool-input streaming, partial JSON parsing |
| `sub_agent.py` | 603 | Sub-agent lifecycle: start, end, finalization, subject generation, resume queue, orphan diagnostics |
| `context.py` | 271 | Context info initialization, summarization events, token tracking, artifacts, workspace write-backs |
| `tool_event.py` | 472 | Tool start/end/progress, approval checks, todo updates, arg humanization, display preview |
| `chat_model.py` | 499 | Chat model stream/end: AI message assembly, usage metric capture, planning tool detection |

### StatusBuilder Transformation

- **Before**: 3,289 lines (post-T07), 30+ methods with full implementations
- **After**: 417 lines — `__init__`, `process_event` dispatch hub, namespace routing, approval state, and thin delegation stubs
- **Pattern**: Module-level functions accept `sb: StatusBuilder` as first arg; `TYPE_CHECKING` prevents circular imports
- **Backward compatibility**: Constants (`PLANNING_TOOLS`, `_MAX_STATUS_RESULT_CHARS`, `_READ_ONLY_TOOLS`, `_TOOL_CONTENT_FIELDS`) and utilities (`_utc_timestamp`, `_find_json_string_value_start`, `_json_unescape_partial`) re-exported from `status_builder.py`

### Design Decisions

- **Module-level functions over classes**: No handler classes or inheritance hierarchies — just functions. This keeps the extraction purely structural with zero new abstractions.
- **Thin delegation stubs on StatusBuilder**: Methods that are public API, called by external modules, or directly mocked by tests retain one-line delegation stubs on `StatusBuilder`. This preserves test compatibility without requiring test rewrites.
- **Re-exports for backward compatibility**: External callers (`hitl.py`, `post_stream.py`, `streaming.py`, `execute_graphton.py`) that import constants and `_utc_timestamp` from `status_builder` continue to work through re-exports.
- **`sb._update_todos()` call pattern**: `tool_event.py` calls `sb._update_todos(...)` (not `update_todos(sb, ...)`) to ensure test mocks patching the `StatusBuilder` method intercept correctly.

## Benefits

- **87% line reduction** in the central class (3,289 → 417 lines)
- **Single-concern modules**: Each handler module can be read, tested, and modified independently
- **Faster onboarding**: New developers can understand tool event handling by reading 472 lines, not 3,289
- **Safer changes**: Modifying sub-agent logic cannot accidentally break formatting or context tracking
- **Test isolation**: Handler modules have clear boundaries — future tests can target individual modules
- **Zero test regressions**: All 282 `test_status_builder.py` tests pass without modification to test logic (only 3 patch targets updated)

## Impact

- **StatusBuilder consumers**: No changes required — public API preserved through delegation stubs and re-exports
- **Test suite**: 282 tests pass; only 3 patch targets updated to point at new module locations
- **Future development**: New event types can be added as new handler modules without touching `StatusBuilder`
- **T08 completes the structural refactoring arc**: T04 (identity dedup) → T05 (namespace routing) → T07 (ExecutionState) → T08 (handler extraction) — `StatusBuilder` is now a thin orchestrator

## Related Work

- **T07**: ExecutionState dataclass extraction — provided the typed state model that handlers operate on
- **T05**: Namespace routing via `parent_ids` — simplified `_register_sub_agent_namespace` before extraction
- **T04**: Identity-based dedup via `ToolCallIdCapture` — eliminated fingerprint complexity before extraction
- **Previous session commit (`e4af7bb7`)**: Initial handler extraction (formatting, streaming_buffers, sub_agent, context) bundled with HITL cleanup

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours (planning + 7-step extraction across 2 sessions)
