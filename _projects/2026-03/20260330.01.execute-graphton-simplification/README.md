# Project: 20260330.01.execute-graphton-simplification

## Overview
Simplify execute_graphton.py through structural extraction, HITL resume cleanup, error deduplication, and targeted LangGraph alignment — without reimagining the fundamentally correct separation between LangGraph (agent execution) and execute_graphton (orchestration/infrastructure).

**Created**: 2026-03-30
**Status**: Active 🟢

## Project Information

### Primary Goal
Reduce execute_graphton.py from 2,184 lines to ~300-400 by extracting a SetupOrchestrator, deduplicating error handling, eliminating compensating complexity in HITL resume matching, and simplifying recursion limit configuration. Make the orchestration function navigable, testable, and maintainable.

### Design Principle
execute_graphton.py is an **orchestration function**, not graph logic. It hydrates execution state from the DB, resolves the resource chain, provisions infrastructure, creates a LangGraph agent, streams events, builds status, handles errors, and cleans up. The simplification preserves this architectural role while making the function navigable and testable.

### Key Analysis Finding
After thorough analysis of execute_graphton.py (2,184 lines), the graphton library, deepagents boundary, all handler modules, and the latest LangGraph capabilities:

- **Event handlers, streaming buffers, and checkpoint validation are NOT duplicating LangGraph.** They are a product-level projection layer that transforms LangGraph events into Stigmer's protobuf status model. LangGraph does not provide built-in mechanisms for: protobuf status construction, approval UX, todo management, sub-agent bookkeeping, CLI-friendly partial JSON streaming, or cross-layer consistency checking. These are genuinely Stigmer-specific concerns.
- **ToolCallIdCapture is still necessary.** LangGraph v2 `astream_events` still omits `tool_call_id` on tool start/end events.
- **The approval_checker pattern is already well-designed.** It uses LangGraph's `interrupt()` internally, with per-tool policy evaluation on top.
- **The simplification opportunities are structural and compensating-complexity elimination, not framework replacement.**

### Timeline
**Target Completion**: No rush, get it right

### Technology Stack
Python, LangGraph, Protobuf, gRPC, Temporal

### Project Type
Refactoring

### Affected Components
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (primary target)
- `backend/services/agent-runner/worker/activities/graphton/` modules (new files for extractions)
- `backend/libs/python/graphton/` (read-only reference, no changes)

## Task Map

```
T01: Quick wins — Error dedup (S3), InlinePublisher (S4), Recursion limit (S5)
  |
  |   T02: Research — LangGraph v2 tool_call_id availability (S6)
  |     |
  |     v
  |   T03: Eliminate HITL bidirectional fallback (S2)
  |     |
  v     v
T04: Extract SetupOrchestrator with parallelization (S1)
```

| Task | Description | Type | Est. Lines Affected | Depends On |
|------|-------------|------|---------------------|------------|
| T01 | Quick wins: error dedup, InlinePublisher, recursion limit | Code | ~180 | None |
| T02 | Research: LangGraph v2 tool_call_id on events | Research | 0 | None |
| T03 | Eliminate HITL bidirectional fallback | Code | ~40 | T02 |
| T04 | Extract SetupOrchestrator with parallelization | Code | ~1,180 reorganized | T01, T03 |

### Estimated Impact

| Metric | Current | After |
|--------|---------|-------|
| `_execute_graphton_impl` lines | ~1,780 | ~100-150 |
| `execute_graphton` total file lines | 2,184 | ~300-400 |
| Setup steps in one function | 14 | Extracted to SetupOrchestrator |
| Error handling duplication | 2 copies | 1 shared helper |
| Closure captures in main function | 6 variables | 0 (class-based) |
| Recursion limit configuration layers | 3 | 1 |
| HITL matching strategies | Primary + bidirectional fallback | Primary only |

## Project Context

### Dependencies
status-builder-hardening project (20260329.02) should land first — StatusBuilder is already refactored from 3,289 to 417 lines and provides a clean foundation

### Success Criteria
- execute_graphton.py reduced to ~300-400 lines
- `_execute_graphton_impl` becomes ~100-150 lines
- Setup phase extracted to SetupOrchestrator with parallelized gRPC fetches
- Error handling deduplicated to single helper
- Inline publish closure extracted to class
- Recursion limit simplified to single source of truth
- HITL bidirectional fallback eliminated
- All existing tests pass unchanged
- No data inconsistencies in production for 2 weeks

### Known Risks & Mitigations
Large refactoring surface in critical runtime path. Mitigated by phasing: quick wins first (T01), research (T02), then cleanup (T03), then big extraction (T04). Each task is a separate PR. No behavioral changes — pure structural refactoring with incremental extraction.

## What This Project Does NOT Change

Per "scope discipline — ask what does this NOT change":

- **StatusBuilder architecture**: Already refactored in T08 of status-builder-hardening (3,289 -> 417 lines)
- **Handler modules**: tool_event, chat_model, streaming_buffers, sub_agent — confirmed as necessary product-level logic
- **Checkpoint validation**: Confirmed as necessary cross-layer consistency checking
- **Streaming executor**: Already well-extracted and clean
- **Post-stream processing**: Already well-extracted
- **Graphton core library**: No changes to `create_deep_agent()`, middleware, or tool wrappers
- **Approval checker pattern**: Already well-designed (policy layer + LangGraph interrupt)
- **Proto definitions**: No proto changes
- **gRPC APIs**: No new RPCs

## Project Structure

This project follows the **Next Project Framework** for structured multi-day development:

- **`tasks/`** - Detailed task planning and execution logs (update freely)
- **`checkpoints/`** - Major milestone summaries (⚠️ ASK before creating)
- **`design-decisions/`** - Significant architectural choices (⚠️ ASK before creating)
- **`coding-guidelines/`** - Project-wide code standards (⚠️ ASK before creating)
- **`wrong-assumptions/`** - Important misconceptions (⚠️ ASK before creating)
- **`dont-dos/`** - Critical anti-patterns (⚠️ ASK before creating)

**IMPORTANT**: Knowledge folders require developer permission.

## Current Status

### Active Task
See [tasks/](tasks/) for the current task being worked on.

### Latest Checkpoint
See [checkpoints/](checkpoints/) for the most recent project state.

### Progress Tracking
- [x] Project initialized
- [x] Initial analysis complete
- [x] T01: Quick wins (error dedup, InlinePublisher, recursion limit)
- [x] T02: Research (LangGraph v2 tool_call_id) -- confirmed ToolCallIdCapture still necessary
- [x] T03: HITL bidirectional fallback elimination
- [ ] T04: SetupOrchestrator extraction
- [ ] Testing and validation
- [ ] Project completed

## How to Resume Work

**Quick Resume**: Simply drag and drop the `next-task.md` file into your AI conversation.

## Quick Links

- [Next Task](next-task.md) - **Drag this into chat to resume**
- [Current Task](tasks/)
- [Latest Checkpoint](checkpoints/)
- [Design Decisions](design-decisions/)
- [Coding Guidelines](coding-guidelines/)

## Documentation Discipline

**CRITICAL**: AI assistants must ASK for permission before creating:
- Checkpoints
- Design decisions
- Guidelines
- Wrong assumptions
- Don't dos

Only task logs (T##_1_feedback.md, T##_2_execution.md) can be updated without permission.

## Notes

- Related project: [20260329.02.status-builder-hardening](../20260329.02.status-builder-hardening/) — StatusBuilder refactoring that provides the clean foundation for this work
- Analysis chat: This project originated from a thorough analysis of execute_graphton.py and the graphton library, examining whether LangGraph framework capabilities could replace custom code
