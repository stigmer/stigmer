# Next Task: 20260330.01.execute-graphton-simplification

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260330.01.execute-graphton-simplification

**Description**: Simplify execute_graphton.py through structural extraction, HITL resume cleanup, error deduplication, and targeted LangGraph alignment — without reimagining the fundamentally correct separation between LangGraph (agent execution) and execute_graphton (orchestration/infrastructure).
**Goal**: Reduce execute_graphton.py from 2,184 lines to ~300-400 by extracting a SetupOrchestrator, deduplicating error handling, eliminating compensating complexity in HITL resume matching, and simplifying recursion limit configuration. Make the orchestration function navigable, testable, and maintainable.
**Tech Stack**: Python, LangGraph, Protobuf, gRPC, Temporal
**Components**: agent-runner execute_graphton.py, worker/activities/graphton/ modules, graphton core library (read-only reference)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260330.01.execute-graphton-simplification/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-30 09:32
**Current Task**: T02 (Research — LangGraph v2 tool_call_id availability)
**Status**: T01 complete, ready for T02

## Session Progress (2026-03-30)

### T01 Completed — Quick Wins
- **S5**: Added `_LANGGRAPH_UNLIMITED_RECURSION` named constant, replaced magic number
- **S3**: Extracted `_persist_and_return_failed_status()` helper, deduplicated two error handlers
- **S4**: Extracted `InlinePublisher` class from 64-line closure into `graphton/inline_publisher.py`
- **Tests**: 9 new unit tests for InlinePublisher; all 1,382 tests pass
- **Impact**: execute_graphton.py 2,184 → 2,127 lines (-57 net, ~110 lines of logic extracted/deduplicated)

### Surprise Discovered & Resolved
- Original plan said to stop passing `recursion_limit` to `create_deep_agent()`, but graphton uses it for `ExecutionBudgetMiddleware` configuration (threshold mode vs periodic mode). Removing it would have been a behavioral change. Kept the pass-through unchanged; S5 became a smaller named-constant-only change.

## Next Steps

1. **T02**: Research whether current LangGraph version exposes `tool_call_id` on `astream_events` tool start/end events (determines if ToolCallIdCapture can be simplified)
2. **T03**: If T02 confirms availability, eliminate HITL bidirectional fallback matching
3. **T04**: Extract SetupOrchestrator with parallelized gRPC fetches (depends on T01 + T03)

## Context for Resume

- T01 changes are committed and all tests pass
- The `_persist_and_return_failed_status` helper is already used by both error handlers — good foundation for T04
- The `InlinePublisher` class established the pattern for extracting closures to classes with explicit dependencies
- Knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos) are still empty — no project-specific patterns established yet beyond what's in the task plan

## Quick Commands

After loading context:
- "Start T02" - Begin LangGraph v2 tool_call_id research
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
