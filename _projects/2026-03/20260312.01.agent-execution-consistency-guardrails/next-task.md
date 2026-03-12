# Next Task: 20260312.01.agent-execution-consistency-guardrails

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Current State

- **Status**: ALL 5 PRs COMPLETE — ready for final review and merge
- **Last Session**: March 12, 2026 (Session 5) — Completed PR4 (Sub-Agent Completion UX)
- **Active Task**: T01 — Agent Execution Consistency Guardrails
- **Committed**: PR3 at `0a4fb06a`, PR1/PR2/PR5 committed on `fix/sub-agent-timer-and-tool-count`, PR4 pending commit

## Session Progress (2026-03-12, Session 5)

- Completed PR4: Fix Sub-Agent Completion UX — make sub-agent completion visible before spinner vanishes
- Two complementary fixes: (1) staged dismissal with 1.5s completion indicator, (2) sub-agent status visible alongside AI stream
- Added `completedSubAgentEntries` list with `subAgentDismissMsg` timed auto-dismiss
- Fixed priority cascade in both `renderTransientContent()` and legacy `View()` — sub-agents now render above AI stream content (same pattern as existing approval case)
- Added `formatSubAgentCompletionLine()` in renderer — generates pre-styled display line using same visual language as scrollback (checkmark/X/cancel)
- Modified `renderSubAgentLine()` to render completed entries (static) above active entries (animated spinner)
- 5 files changed, 397 insertions, 55 deletions
- 28 tests passing (16 new, 3 rewritten, 9 existing unchanged)
- Plan document: `.cursor/plans/pr4_sub-agent_completion_ux_b34b1a7e.plan.md`

## Next Steps

1. **Commit PR4** — Stage and commit the Go CLI changes
2. **Final review** — All 5 PRs are complete; review the full changeset across the branch
3. **Deferred follow-ups** — Compaction notification (from PR2) can be addressed as a separate project

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
- Session notes in `checkpoints/2026-03-12-session-1.md` (PR3), `checkpoints/2026-03-12-session-2.md` (PR1), `checkpoints/2026-03-12-session-3.md` (PR2), `checkpoints/2026-03-12-session-4.md` (PR5), and `checkpoints/2026-03-12-session-5.md` (PR4)
- The user operates under the **Architect Role** (`_roles/001_architect.md`): high-quality code, challenge assumptions, pause on surprises, collaborate on decisions
- User explicitly wants: no complacency, no technical debt, pause and collaborate on architectural decisions, challenge when something doesn't align with platform quality
- PR4 plan with design rationale is in `.cursor/plans/pr4_sub-agent_completion_ux_b34b1a7e.plan.md`

## Project: 20260312.01.agent-execution-consistency-guardrails

**Description**: Fix five critical architectural gaps in Stigmer's agent execution pipeline that produce inconsistent behavior: (1) LoopDetectionMiddleware is completely dead code because aafter_step is not a valid AgentMiddleware hook, (2) ContextSummarizationMiddleware only checks tokens at graph-start so context can overflow mid-execution, (3) recursion_limit is overridden from 100 to 1000 (10x the intended value), (4) sub-agent completion UX is invisible due to renderTransientContent priority cascade, and (5) execution is marked COMPLETED while sub-agents are still IN_PROGRESS.
**Goal**: Implement working loop detection, mid-execution token checking, correct recursion limits, persistent sub-agent completion indicators, and graceful execution finalization.
**Tech Stack**: Python (LangGraph AgentMiddleware hooks, graphton library, agent-runner Temporal activities), Go (CLI Bubbletea TUI renderer, gRPC stream consumer), Protobuf (AgentExecution status model)

## PR Progress

| PR | Description | Status | Commit |
|----|-------------|--------|--------|
| PR3 | Recursion Limit Fix | **DONE** | `0a4fb06a` |
| PR1 | Loop Detection Middleware Fix | **DONE** | `adc43ff1` |
| PR2 | Mid-Execution Context Compaction | **DONE** | `12e05d2e` |
| PR5 | Premature Completion Fix | **DONE** | `5d147959` |
| PR4 | Sub-Agent Completion UX | **DONE** | pending commit |

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/checkpoints/2026-03-12-session-5.md
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

### Finding 3: Sub-Agent UI Priority Cascade — **FIXED in PR4**
- **Fixed**: Sub-agent status lines now render above AI stream content in both `renderTransientContent()` and legacy `View()` paths
- **Fixed**: Sub-agent completion shows a 1.5s static indicator (checkmark/X/cancel) before dismissing to scrollback
- Previously: `renderTransientContent()` had priority cascade where `aiStreamActive` hid sub-agent entries entirely

### Finding 4: Premature Completion — **FIXED in PR5**
- **Fixed**: Post-stream reconciliation detects orphaned sub-agents and sets `EXECUTION_FAILED` with differentiated sub-agent statuses (CANCELLED for zero-message, FAILED for mid-execution)
- **Root cause identified**: `astream_events` can end without raising an exception when the graph crashes internally (context overflow, unhandled exception in a node) — the observation layer could not distinguish normal completion from silent termination
- `finalize_active_sub_agents()` was only called in error handlers, not in the "silent completion" path
- Production evidence: execution `aex-01kkg22yeeez6579b8mcaz5bwt` had 9 of 14 sub-agents stuck in `IN_PROGRESS`

### Key Discovery from PR1 Implementation
- `aafter_model` cannot prevent tool execution for the current turn — the routing edge (`_make_model_to_tools_edge`) checks the last AIMessage, not the last message in state
- `awrap_tool_call` provides true enforcement by intercepting individual tool calls before execution
- This two-hook pattern (detection in `aafter_model`, enforcement in `awrap_tool_call`) may also be useful for PR2

### Key Discovery from PR4 Implementation
- Bubbletea has TWO rendering paths: legacy `View()` (flat switch) and `renderComposedView()` (uses `renderTransientContent()`). Both must be fixed for any priority cascade change.
- The approval case already renders sub-agents alongside with `renderSubAgentLine() + "\n\n" + approvalView` — the AI stream fix follows the same pattern.
- `tea.Tick` is the idiomatic way to implement timers in Bubbletea without goroutines.

### Key Discovery from PR5 Investigation
- Sub-agent execution model is architecturally correct: sub-agents are synchronous subgraphs invoked via `interrupt_proxy.py` — their failures propagate to the parent as error ToolMessages, identical to how Cursor handles sub-agents
- The bug was in the observation layer (`execute_graphton.py`), not the execution model
- Active sub-agents at stream end is **always** abnormal — healthy executions complete all subgraphs before the stream ends

### Related Prior Work
- Project `20260309.01.sub-agent-execution-streamline` (COMPLETED)
- Heartbeat timeout fix (committed 2026-03-12)

### Production Execution Analyzed
- Execution ID: `aex-01kkg22yeeez6579b8mcaz5bwt`
- Full data in `stigmer/_cursor/data.yaml` (56K+ lines)

## Quick Commands

After loading context:
- "Show project status" — Get overview of progress
- "Work on deferred items" — StatusBuilder + CLI compaction notifications

---

*This file provides direct paths to all project resources for quick context loading.*
