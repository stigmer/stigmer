# Next Task: 20260312.01.agent-execution-consistency-guardrails

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Current State

- **Status**: ALL 5 PRs + D1–D5 COMPLETE — EXECUTION_TERMINATED phase done
- **Last Session**: March 12, 2026 (Session 8) — Completed D5 (EXECUTION_TERMINATED as platform-initiated stop)
- **Active Task**: T01 — Agent Execution Consistency Guardrails (deferred follow-ups)
- **Committed**: PR3 at `0a4fb06a`, PR1/PR2/PR5 on `fix/sub-agent-timer-and-tool-count`, PR4 at `28e94919`, D1–D5 pending commit

## Session Progress (2026-03-12, Session 8)

- Completed D5: Broadened `EXECUTION_TERMINATED` from "force-kill only" to "platform-initiated stop"
- Updated proto comment and header: two trigger paths (internal stall/budget, external Terminate RPC), three-way taxonomy (FAILED/TERMINATED/CANCELLED)
- Stall timeout: `EXECUTION_FAILED` → `EXECUTION_TERMINATED`, sub-agents from `SUB_AGENT_FAILED` → `SUB_AGENT_CANCELLED`
- Recursion limit: `EXECUTION_FAILED` → `EXECUTION_TERMINATED`
- Fixed 4 CLI gaps: `renderPhaseChange`, `displayAgentPhaseChange`, `displaySessionExitLine` reason, `isFollowUpEligible`
- Design decision: Option A (broaden phase semantics) over Option B (error_code metadata) — phase-level distinction gives immediate UX value (yellow vs red)
- Design decision: Orphaned sub-agents remain EXECUTION_FAILED (silent crash is "something broke," not "platform stopped it")
- 7 files changed, ~47 insertions, all tests passing

## Next Steps

1. **Deferred follow-ups** — Pick from the remaining inventory below (D6–D10)
2. **Top candidates**: D9 (SystemMessage interleaving validation) or D10 (pre-existing integration test failures) for codebase hygiene

## All Deferred Follow-Ups

Complete inventory of items intentionally deferred during the 5-PR project. Grouped by origin PR and ordered by priority within each group.

### From PR3 / Session 1: Recursion Limit Configurability — **DONE (Session 6)**

| # | Item | Status | Commit |
|---|------|--------|--------|
| D1 | `max_tool_rounds` in `ExecutionConfig` proto | **DONE** | pending |
| D2 | `ExecutionBudgetMiddleware` — 80% wrap-up warning | **DONE** | pending |

- **D1**: Added `int32 max_tool_rounds = 3` to `ExecutionConfig` proto. Mapping: `recursion_limit = max_tool_rounds * 2`. Default 0 = platform default (50 rounds / 100 super-steps). Range: 10–250 rounds, clamped with warning. Orchestrator reads and passes to `create_deep_agent()`.
- **D2**: New `ExecutionBudgetMiddleware` in graphton. Tracks model rounds via `aafter_model`, injects a single SystemMessage at ~80% of budget telling the model to wrap up. Separate from `LoopDetectionMiddleware` (resource management vs behavioral detection). 39 tests.

### From PR2 / Session 3: Compaction UX Notifications — **DONE (Session 7)**

| # | Item | Status | Commit |
|---|------|--------|--------|
| D3 | User-Visible Compaction Notification (StatusBuilder + gRPC) | **DONE** | pending |
| D4 | CLI Compaction Notification Rendering | **DONE** | pending |

- **D3**: Added `SummarizationSource` enum to proto (`graph_start`, `mid_execution`), `source` field to `SummarizationEvent` proto and `SummarizationEventData` dataclass. StatusBuilder uses `SummarizationSource.Value()` for enum-derived mapping. `_sync_context_info()` + `force_next_update` for immediate gRPC delivery. Graphton proto boundary preserved — string constants bridge it.
- **D4**: `ContextCompactedEvent` type, count-based dedup in `streamToEvents`, `mapSummarizationSource()` converter, dimmed system line: "Context compacted: 185K → 80K tokens (57% reduction)". JSON mode outputs `context_compacted` event. All tests passing.

### From PR5 / Session 4: Execution Status Refinement — **DONE (Session 8)**

| # | Item | Status | Commit |
|---|------|--------|--------|
| D5 | `EXECUTION_TERMINATED` as platform-initiated stop | **DONE** | pending |

- **D5**: Broadened `EXECUTION_TERMINATED` from "force-kill only" to "platform-initiated stop." Stall timeout and recursion limit now set `EXECUTION_TERMINATED` (was `EXECUTION_FAILED`). Proto comment updated with two trigger paths (internal/external) and three-way taxonomy (FAILED/TERMINATED/CANCELLED). Fixed 4 CLI gaps: `renderPhaseChange`, `displayAgentPhaseChange`, `displaySessionExitLine` reason, `isFollowUpEligible`. All tests passing.

### From PR4 / Session 5: Sub-Agent UX Edge Case

| # | Item | Scope | Files |
|---|------|-------|-------|
| D6 | `streamingActive` case showing sub-agents | Go CLI | `run_stream_inline_bubbletea.go` |

- **D6**: The tool output streaming priority case doesn't show sub-agents alongside. Less common scenario (only when tool output is actively streaming while sub-agents are running). Low priority.

### Softer / Future Enhancement Items

| # | Item | Origin | Notes |
|---|------|--------|-------|
| D7 | Rehydration after compaction | PR2 / Session 3 | Claude Code restores recent files, todos, continuation instructions post-compaction. Our LangMem summarization preserves some context, but structured rehydration could be a future enhancement. |
| D8 | Incomplete todos as abnormal termination signal | PR5 / Session 4 | Using pending todos alongside orphaned sub-agents. Deferred — orphaned sub-agents is the stronger and more reliable signal. |
| D9 | SystemMessage interleaving validation | PR1 / Session 2 | When `aafter_model` injects a SystemMessage between AIMessage and ToolMessages, validate compatibility with StatusBuilder message parsing and summarization middleware token counting. |
| D10 | Pre-existing integration test failures | PR2 / Session 3 | 3 tests in integration suite have pre-existing issues (module-level patching of `summarize_messages`, incorrect token count assumptions). Cleanup pass needed. |

## Context for Resume

- The plan is in `tasks/T01_0_plan.md` — DO NOT edit it
- Design decision for recursion limit value documented in `design-decisions/001-recursion-limit-value.md`
- Session notes in `checkpoints/2026-03-12-session-{1..8}.md` (PR3, PR1, PR2, PR5, PR4, D1+D2, D3+D4, D5)
- The user operates under the **Architect Role** (`_roles/001_architect.md`): high-quality code, challenge assumptions, pause on surprises, collaborate on decisions
- User explicitly wants: no complacency, no technical debt, pause and collaborate on architectural decisions, challenge when something doesn't align with platform quality
- Key files from D1+D2:
  - `backend/libs/python/graphton/src/graphton/core/execution_budget.py` (new — middleware)
  - `backend/libs/python/graphton/src/graphton/core/config.py` (`budget_warning_pct` validation)
  - `backend/libs/python/graphton/src/graphton/core/agent.py` (wiring)
  - `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto` (`max_tool_rounds` field)
  - `backend/services/agent-runner/worker/activities/execute_graphton.py` (orchestrator)

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
| PR4 | Sub-Agent Completion UX | **DONE** | `28e94919` |
| PR6 (D2) | Execution Budget Middleware | **DONE** | pending commit |
| PR7 (D1) | `max_tool_rounds` Proto Configurability | **DONE** | pending commit |
| PR8 (D3) | Compaction Notification (Backend + Proto) | **DONE** | pending commit |
| PR9 (D4) | CLI Compaction Rendering | **DONE** | pending commit |
| PR10 (D5) | EXECUTION_TERMINATED Phase | **DONE** | pending commit |

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260312.01.agent-execution-consistency-guardrails/checkpoints/2026-03-12-session-8.md
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
- ~~"Work on D1+D2"~~ — DONE (Session 6)
- ~~"Work on D3+D4"~~ — DONE (Session 7)
- ~~"Work on D5"~~ — DONE (Session 8)
- "Show all deferred items" — Review the full D6–D10 inventory

---

*This file provides direct paths to all project resources for quick context loading.*
