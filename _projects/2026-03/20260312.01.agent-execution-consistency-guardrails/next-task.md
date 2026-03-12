# Next Task: 20260312.01.agent-execution-consistency-guardrails

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Current State

- **Status**: in-progress (1 of 5 PRs complete)
- **Last Session**: March 12, 2026 — Completed PR3 (Recursion Limit Fix)
- **Active Task**: T01 — Agent Execution Consistency Guardrails
- **Committed**: `0a4fb06a` on `fix/sub-agent-timer-and-tool-count`

## Session Progress (2026-03-12)

- Completed PR3: Removed two `recursion_limit=1000` overrides from `execute_graphton.py`, restoring graphton's intended default of 100
- Added `GraphRecursionError` handler with user-friendly "send another message to continue" UX
- Fixed stale docstrings and Cursor rule examples referencing 1000
- Added observability log for effective recursion_limit at agent startup
- Updated 4 unit tests; all tests passing
- Conducted industry comparison (Cursor, Claude Code, OpenAI Agents SDK) to validate the 100 limit
- Created changelog entry: `_changelog/2026-03/2026-03-12-105522-fix-recursion-limit-10x-inflation.md`

## Next Steps

1. **PR1: Fix LoopDetectionMiddleware** — Move detection logic from dead `aafter_step` to `aafter_model` hook. Highest-leverage fix for preventing self-improvement loops. File: `backend/libs/python/graphton/src/graphton/core/loop_detection.py`
2. **PR2: Fix ContextSummarizationMiddleware** — Add `aafter_model` mid-execution token check. Prevents context overflow. Similar pattern to PR1. File: `backend/libs/python/graphton/src/graphton/core/summarization_middleware.py`
3. **PR5: Fix Premature Execution Completion** — Check for active sub-agents before setting `EXECUTION_COMPLETED`. Cancel in-flight sub-agents with clear status. File: `execute_graphton.py`
4. **PR4: Fix Sub-Agent Completion UX** — Make completion visible before spinner vanishes. Go CLI Bubbletea work. Files: `run_stream_inline_bubbletea.go`, `run_stream_inline_render.go`

## Context for Resume

- The plan is in `tasks/T01_0_plan.md` — DO NOT edit it
- Design decision for recursion limit value documented in `design-decisions/001-recursion-limit-value.md`
- Session notes in `checkpoints/2026-03-12-session-1.md`
- The user operates under the **Architect Role** (`_roles/001_architect.md`): high-quality code, challenge assumptions, pause on surprises, collaborate on decisions
- User explicitly wants: no complacency, no technical debt, pause and collaborate on architectural decisions, challenge when something doesn't align with platform quality

## Project: 20260312.01.agent-execution-consistency-guardrails

**Description**: Fix five critical architectural gaps in Stigmer's agent execution pipeline that produce inconsistent behavior: (1) LoopDetectionMiddleware is completely dead code because aafter_step is not a valid AgentMiddleware hook, (2) ContextSummarizationMiddleware only checks tokens at graph-start so context can overflow mid-execution, (3) recursion_limit is overridden from 100 to 1000 (10x the intended value), (4) sub-agent completion UX is invisible due to renderTransientContent priority cascade, and (5) execution is marked COMPLETED while sub-agents are still IN_PROGRESS.
**Goal**: Implement working loop detection, mid-execution token checking, correct recursion limits, persistent sub-agent completion indicators, and graceful execution finalization.
**Tech Stack**: Python (LangGraph AgentMiddleware hooks, graphton library, agent-runner Temporal activities), Go (CLI Bubbletea TUI renderer, gRPC stream consumer), Protobuf (AgentExecution status model)

## PR Progress

| PR | Description | Status | Commit |
|----|-------------|--------|--------|
| PR3 | Recursion Limit Fix | **DONE** | `0a4fb06a` |
| PR1 | Loop Detection Middleware Fix | PENDING | — |
| PR2 | Mid-Execution Summarization | PENDING | — |
| PR5 | Premature Completion Fix | PENDING | — |
| PR4 | Sub-Agent Completion UX | PENDING | — |

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/checkpoints/2026-03-12-session-1.md
```

### 2. Current Task Plan
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/design-decisions/001-recursion-limit-value.md
```

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/dont-dos/
```

## Discovery Context (Crucial for Future Sessions)

This project was born from a production incident analysis on 2026-03-12. Key verified findings:

### Finding 1: `aafter_step` Does Not Exist in AgentMiddleware
- Both `LoopDetectionMiddleware` and `ContextSummarizationMiddleware` implement `aafter_step()`
- LangChain's `AgentMiddleware` base class only supports: `abefore_agent`, `abefore_model`, `aafter_model`, `aafter_agent`, `awrap_model_call`, `awrap_tool_call`
- This was verified via runtime introspection of the installed `langchain` package
- All logic in `aafter_step()` is dead code — never called

### Finding 2: Recursion Limit Inflation — **FIXED in PR3**
- ~~`execute_graphton.py` overrides to `1000` in TWO places (lines 2288 and 2324)~~
- **Fixed**: Both overrides removed. Graphton's default of 100 is now the single source of truth.
- **Added**: `GraphRecursionError` handler for graceful degradation.

### Finding 3: Sub-Agent UI Priority Cascade
- `renderTransientContent()` in Bubbletea has priority: `approvalActive > streamingActive > aiStreamActive > activeSubAgentEntries`
- When AI streaming starts, sub-agent entries become invisible immediately

### Finding 4: Premature Completion
- `execute_graphton.py` sets `EXECUTION_COMPLETED` without checking for active sub-agents
- `finalize_active_sub_agents()` exists but is only called in error handlers

### Related Prior Work
- Project `20260309.01.sub-agent-execution-streamline` (COMPLETED)
- Heartbeat timeout fix (committed 2026-03-12)

### Production Execution Analyzed
- Execution ID: `aex-01kkg22yeeez6579b8mcaz5bwt`
- Full data in `stigmer/_cursor/data.yaml` (56K+ lines)

## Quick Commands

After loading context:
- "Start PR1" — Begin with loop detection middleware fix (highest impact, recommended next)
- "Start PR2" — Begin with mid-execution summarization
- "Start PR5" — Begin with premature completion fix (stays in execute_graphton.py)
- "Show project status" — Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
