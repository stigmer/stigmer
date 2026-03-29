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
**Current Task**: T03 (Research: namespace injection feasibility)
**Next Code Task**: T04 (Replace fingerprint dedup with tool_call_id lookup — unblocked by T02)
**Status**: Active — T02 complete, T03 pending, T04 unblocked

### T02 Key Finding
v2 events do NOT carry `tool_call_id`. Solution: a ~10-line `ToolCallIdCapture`
callback handler captures `{run_id → tool_call_id}` from the callback API (which
does receive it). Works for ALL tools universally. Eliminates 3 dictionaries, 2
methods, and ~100 lines of fingerprint/FIFO dedup logic. See `tasks/T02_0_research.md`.

## Session Progress (2026-03-29)

### What was accomplished
- Reviewed and approved v2 plan (T01_0_plan.md)
- Completed T02 research: traced LangGraph/LangChain event pipeline across 5 framework layers
- Discovered that `_filter_injected_args` blocks the naive `InjectedToolCallId` approach
- Identified `ToolCallIdCapture` callback handler as the clean, universal solution
- Wrote comprehensive research document (`tasks/T02_0_research.md`, 304 lines)
- Updated `_roles/005_ai_engineer.md` with architectural principles from HITL learnings

### Key decisions
- Callback handler approach chosen over modifying tool wrappers (universal coverage, simpler)
- Live validation skipped — findings based on reading actual installed package source code

### Surprise discovered
`BaseTool._filter_injected_args` strips `InjectedToolCallId` values from callback inputs
before they reach the v2 event emitter. This means `data.input` will never contain
`tool_call_id` regardless of wrapper annotations. The callback handler approach is
necessary and also superior (works for ALL tools without per-wrapper changes).

## Next Steps (when you return)
1. Start T03 research — namespace injection feasibility in Graphton sub-graph construction
2. Start T04 implementation — replace fingerprint dedup with `ToolCallIdCapture` (unblocked)
3. T06 (pause fix) can be done anytime as a standalone task

## Quick Commands

After loading context:
- "Start T03 research" - Investigate namespace injection in Graphton sub-graph construction
- "Start T04 implementation" - Replace fingerprint dedup with tool_call_id lookup (requires T02 findings)
- "Show project status" - Get overview of progress
- "Review the plan" - Read the v2 task plan

---

*This file provides direct paths to all project resources for quick context loading.*
