# Next Task: 20260312.01.agent-execution-consistency-guardrails

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Current State

- **Status**: in-progress (3 of 5 PRs complete)
- **Last Session**: March 12, 2026 (Session 3) — Completed PR2 (Mid-Execution Context Compaction)
- **Active Task**: T01 — Agent Execution Consistency Guardrails
- **Committed**: PR3 at `0a4fb06a`, PR1 pending commit on `fix/sub-agent-timer-and-tool-count`, PR2 pending commit

## Session Progress (2026-03-12, Session 3)

- Completed PR2: Claude Code-inspired mid-execution context compaction
- Added `awrap_model_call()` — Layer A primary compaction: counts tokens, triggers LangMem summarization when above trigger_threshold, passes compacted request via `dataclasses.replace()`
- Added `aafter_model()` — Layer B monitoring: reports state tokens via callback, injects emergency SystemMessage when compaction failed AND tokens >= overflow_threshold (95% of context window)
- Added `awrap_tool_call()` — Layer B enforcement: blocks tool execution when `_overflow_imminent` flag is set after emergency warning
- Removed dead `aafter_step()` method entirely (same pattern as PR1)
- Added `context_window_tokens` field + `overflow_threshold` property to `SummarizationConfig`
- Updated `abefore_agent` to reset compaction state, `aafter_agent` to log compaction stats
- Created comprehensive test suite: 26 new tests in 4 classes (TestAwrapModelCall, TestAafterModel, TestAwrapToolCallSummarization, TestCompactionLifecycle), all passing
- Added 2 integration tests for full compaction lifecycle with callbacks
- Verified LangGraph factory auto-detects all three new hooks
- Plan document: `.cursor/plans/pr2_summarization_overflow_brake_2ae56946.plan.md`

## Next Steps

1. **PR5: Fix Premature Execution Completion** — Check for active sub-agents before setting `EXECUTION_COMPLETED`. Cancel in-flight sub-agents with clear status. File: `execute_graphton.py`
2. **PR4: Fix Sub-Agent Completion UX** — Make completion visible before spinner vanishes. Go CLI Bubbletea work. Files: `run_stream_inline_bubbletea.go`, `run_stream_inline_render.go`

## Deferred Follow-Ups (from PR2)

These items were intentionally deferred from PR2 to keep it focused on the middleware:

### 1. User-Visible Compaction Notification (StatusBuilder + gRPC)
- Add `source: str` field to `SummarizationEventData` in `summarization_callback.py` (values: `"graph_start"`, `"mid_execution"`)
- In `StatusBuilder.on_summarization_complete()`, call `self._force_next_update()` for immediate CLI delivery
- Proto `SummarizationEvent` may need a `source` field
- **Where**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

### 2. CLI Compaction Notification Rendering (Bubbletea)
- Detect new `SummarizationEvent` entries in the streamed `ContextInfo`
- Render notification: "Context compacted: 180K -> 120K tokens (33% reduction)"
- **Where**: `client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go`
- Naturally aligns with PR4 (Sub-Agent Completion UX) or could be a standalone follow-up

## Context for Resume

- The plan is in `tasks/T01_0_plan.md` — DO NOT edit it
- Design decision for recursion limit value documented in `design-decisions/001-recursion-limit-value.md`
- Session notes in `checkpoints/2026-03-12-session-1.md` (PR3), `checkpoints/2026-03-12-session-2.md` (PR1), and `checkpoints/2026-03-12-session-3.md` (PR2)
- The user operates under the **Architect Role** (`_roles/001_architect.md`): high-quality code, challenge assumptions, pause on surprises, collaborate on decisions
- User explicitly wants: no complacency, no technical debt, pause and collaborate on architectural decisions, challenge when something doesn't align with platform quality
- PR1 plan with research findings and accepted decisions is in `.cursor/plans/pr1_loop_detection_fix_b21345e6.plan.md`

## Project: 20260312.01.agent-execution-consistency-guardrails

**Description**: Fix five critical architectural gaps in Stigmer's agent execution pipeline that produce inconsistent behavior: (1) LoopDetectionMiddleware is completely dead code because aafter_step is not a valid AgentMiddleware hook, (2) ContextSummarizationMiddleware only checks tokens at graph-start so context can overflow mid-execution, (3) recursion_limit is overridden from 100 to 1000 (10x the intended value), (4) sub-agent completion UX is invisible due to renderTransientContent priority cascade, and (5) execution is marked COMPLETED while sub-agents are still IN_PROGRESS.
**Goal**: Implement working loop detection, mid-execution token checking, correct recursion limits, persistent sub-agent completion indicators, and graceful execution finalization.
**Tech Stack**: Python (LangGraph AgentMiddleware hooks, graphton library, agent-runner Temporal activities), Go (CLI Bubbletea TUI renderer, gRPC stream consumer), Protobuf (AgentExecution status model)

## PR Progress

| PR | Description | Status | Commit |
|----|-------------|--------|--------|
| PR3 | Recursion Limit Fix | **DONE** | `0a4fb06a` |
| PR1 | Loop Detection Middleware Fix | **DONE** | pending commit |
| PR2 | Mid-Execution Context Compaction | **DONE** | pending commit |
| PR5 | Premature Completion Fix | PENDING | — |
| PR4 | Sub-Agent Completion UX | PENDING | — |

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/checkpoints/2026-03-12-session-3.md
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

### Finding 1: `aafter_step` Does Not Exist in AgentMiddleware — **FIXED in PR1 + PR2**
- ~~Both `LoopDetectionMiddleware` and `ContextSummarizationMiddleware` implement `aafter_step()`~~
- **Fixed (LoopDetection, PR1)**: Replaced with `aafter_model` (detection) + `awrap_tool_call` (enforcement)
- **Fixed (Summarization, PR2)**: Replaced with `awrap_model_call` (Layer A compaction) + `aafter_model` + `awrap_tool_call` (Layer B emergency brake). Dead `aafter_step()` removed.
- LangChain's `AgentMiddleware` base class only supports: `abefore_agent`, `abefore_model`, `aafter_model`, `aafter_agent`, `awrap_model_call`, `awrap_tool_call`

### Finding 2: Recursion Limit Inflation — **FIXED in PR3**
- **Fixed**: Both overrides removed. Graphton's default of 100 is now the single source of truth.
- **Added**: `GraphRecursionError` handler for graceful degradation.

### Finding 3: Sub-Agent UI Priority Cascade
- `renderTransientContent()` in Bubbletea has priority: `approvalActive > streamingActive > aiStreamActive > activeSubAgentEntries`
- When AI streaming starts, sub-agent entries become invisible immediately

### Finding 4: Premature Completion
- `execute_graphton.py` sets `EXECUTION_COMPLETED` without checking for active sub-agents
- `finalize_active_sub_agents()` exists but is only called in error handlers

### Key Discovery from PR1 Implementation
- `aafter_model` cannot prevent tool execution for the current turn — the routing edge (`_make_model_to_tools_edge`) checks the last AIMessage, not the last message in state
- `awrap_tool_call` provides true enforcement by intercepting individual tool calls before execution
- This two-hook pattern (detection in `aafter_model`, enforcement in `awrap_tool_call`) may also be useful for PR2

### Related Prior Work
- Project `20260309.01.sub-agent-execution-streamline` (COMPLETED)
- Heartbeat timeout fix (committed 2026-03-12)

### Production Execution Analyzed
- Execution ID: `aex-01kkg22yeeez6579b8mcaz5bwt`
- Full data in `stigmer/_cursor/data.yaml` (56K+ lines)

## Quick Commands

After loading context:
- "Start PR5" — Begin with premature completion fix (recommended next, stays in execute_graphton.py)
- "Start PR4" — Begin with sub-agent completion UX (Go CLI Bubbletea)
- "Show project status" — Get overview of progress
- "Work on deferred items" — StatusBuilder + CLI compaction notifications

---

*This file provides direct paths to all project resources for quick context loading.*
