# Next Task: 20260329.02.status-builder-hardening

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260329.02.status-builder-hardening

**Description**: Simplify StatusBuilder from a 3,648-line god object with 30+ ad-hoc dictionaries into a clean reducer/event-sourcing pattern. Eliminate compensating complexity (fingerprint dedup, namespace heuristics, reconciliation queues) by using LangGraph's identity mechanisms directly. Target: ~10-12 well-defined indexes/buffers, identity-based lookups, small focused event handlers.
**Goal**: Replace ad-hoc dictionary accumulation with a properly designed state model using the reducer/event-sourcing pattern. All lookups identity-based, all state explicit and recoverable, event handlers small and focused.
**Tech Stack**: Python, LangGraph, Protobuf, gRPC, Temporal
**Components**: agent-runner StatusBuilder, streaming.py, hitl.py, post_stream.py, checkpoint_validator.py, execute_graphton.py, graphton core (namespace/sub-agent identity)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260329.02.status-builder-hardening/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-29 14:37
**Plan Revised**: 2026-03-29 19:30 (v2 — reducer pattern simplification)
**T02 Completed**: 2026-03-29 (tool_call_id availability confirmed via callback handler approach)
**T04 Completed**: 2026-03-29 (fingerprint dedup replaced with identity-based lookup)
**T03 Completed**: 2026-03-29 (namespace routing via parent_ids confirmed — Approach B)
**Current Task**: T05 (Replace namespace heuristics with parent_ids-based deterministic routing)
**Next Code Task**: T05, T06 (pause fix standalone)
**Status**: Active — T02+T03+T04 complete, T05 unblocked

### T02 Key Finding
v2 events do NOT carry `tool_call_id`. Solution: a ~10-line `ToolCallIdCapture`
callback handler captures `{run_id → tool_call_id}` from the callback API (which
does receive it). Works for ALL tools universally. See `tasks/T02_0_research.md`.

### T03 Key Finding
`parent_ids` on v2 events traces the full callback chain from sub-agent events
back to the parent invocation context (including the task tool's `run_id` that
StatusBuilder already knows). Namespace roots are SHARED across concurrent
sub-agents from the same parent node — root-prefix matching is inherently wrong
for disambiguation. `parent_ids` provides deterministic mapping without heuristics.
Approach A (checkpoint_ns injection) discarded — unnecessary and couples to
InterruptProxyRunnable which is being eliminated. See `tasks/T03_0_research.md`.

### T04 Completion Summary
Replaced SHA256 fingerprint dedup with identity-based lookup via `ToolCallIdCapture`.
Deleted 3 dictionaries (`tool_call_fingerprints`, `_fingerprint_to_tool_call_id`,
`_reconciled_resume_tool_calls`), 2 methods, ~100 lines of fingerprint/FIFO logic.
Net: -197 lines. All 1,375 tests pass. Files changed:
- New: `tool_call_id_capture.py` (focused collaborator)
- Modified: `status_builder.py`, `execute_graphton.py`, `hitl.py`
- Tests: `test_status_builder.py`, `test_hitl_contracts.py`

## Session Progress (2026-03-29, session 2)

### What was accomplished
- Completed T04: replace fingerprint dedup with `ToolCallIdCapture` identity lookup
- Created `tool_call_id_capture.py` — focused callback handler (~45 lines)
- Wired capture into execute_graphton.py (constructor + config callbacks)
- Replaced 60-line fingerprint+FIFO dedup block with ~15-line identity lookup
- Renamed `populate_fingerprints_from_existing_tool_calls` → `rebuild_index_from_persisted_status`
- Deleted `_get_tool_fingerprint()`, removed hashlib/deque imports
- Cleaned hitl.py: renamed method, deleted FIFO block, updated logging
- Rewrote 4 alias tests, deleted 4 fingerprint tests, updated 8+ test method calls
- Full test suite: 1,375 passed, 0 failed

### Key decisions
- Kept `_run_id_aliases` for T04 scope discipline — deferring to T07 for broader identity cleanup
- `ToolCallIdCapture` placed in its own module per "StatusBuilder Is NOT a Dumping Ground"
- Used `TYPE_CHECKING` guard for the import, string annotation for the constructor param

## Next Steps (when you return)
1. T03 research COMPLETE — `parent_ids` confirmed as deterministic routing mechanism
2. Start T05 — replace namespace heuristic cascade with `parent_ids`-based registration
3. T06 (pause fix) can be done anytime as a standalone task
4. T07 — ExecutionState refactor (fold `_run_id_aliases` into capture or eliminate)
5. Note: InterruptProxyRunnable elimination (separate project) will further simplify T05

## Quick Commands

After loading context:
- "Start T05 implementation" - Replace _run_id_to_tool_call_id with _tool_call_index
- "Start T06 implementation" - Fix pause handling (standalone)
- "Show project status" - Get overview of progress
- "Review the plan" - Read the v2 task plan

---

*This file provides direct paths to all project resources for quick context loading.*
