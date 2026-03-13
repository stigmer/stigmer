# Next Task: 20260313.01.usage-metrics-cost-optimization

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260313.01.usage-metrics-cost-optimization

**Description**: Address gaps in agent execution usage metrics tracking (cost/pricing data, cache token differentiation) and implement usage optimization techniques (prompt caching, tool result truncation, model routing) to enable accurate cost reporting and minimize LLM costs.
**Goal**: Enable per-execution cost reporting with accurate pricing, implement prompt caching for cost optimization, and provide CLI-level usage/cost visibility with historical reporting RPCs.
**Tech Stack**: Protobuf/gRPC (API schema), Go (stigmer-server, CLI), Python (agent-runner/LangGraph), Java (Temporal workflows)
**Components**: Proto APIs (agentexecution/v1, session/v1), agent-runner (Python/LangGraph), stigmer-server (Go), CLI (Go)

## Current State
- **Status**: In Progress
- **Last Session**: 2026-03-13 — Phase 3 Cleanup completed
- **Active Task**: Phase 3 Cleanup complete. Next: Phase 3B → Phase 4
- **Branch**: `feat/usage-metrics-and-cost-optimization`

## Session Progress (2026-03-13, Session 4)

### Phase 3 Cleanup: Proto Import Migration & Test Updates — COMPLETED

Fixed all remaining proto import migration issues and test breakage left over from Phase 3's `StatusBuilder` → `UsageTracker` extraction. The full agent-runner test suite is now green (1193 passed, 0 failed).

**What was done (2 files, +46 -143):**

1. **Top-level import consolidation** in `test_status_builder.py`: Added `AgentExecutionStatus`, `PendingApproval`, `ToolCall`, `ApprovalAction`, `ExecutionPhase`, `SubAgentStatus` to top-level imports from their correct `_pb2` modules.

2. **Removed 18 inline `api_pb2` imports** across 4 test classes (`TestResumeFromApprovalDetection`, `TestContextManagementTracking`, `TestRunIdAliasResolution`, `TestOrphanedSubAgentDetection`).

3. **Fixed 1 wrong module import**: `ToolCall` was imported from `approval_pb2` instead of `message_pb2` in `TestPhase54ApprovalClearing`.

4. **Replaced 7 internal field assertions** with public API checks (`_total_prompt_tokens` → `current_status.usage.prompt_tokens`).

5. **Deleted 3 obsolete tests** that called removed private methods (`_build_usage_metrics`, `_build_sub_agent_usage`) — covered by 23 existing tests in `test_usage_tracker.py`.

6. **Fixed 22 mock setups**: `MagicMock()` → `MagicMock(input_token_details=None)` — root cause of 20+ test failures (MagicMock auto-attribute creation defeated the Phase 3 cache token extraction code's `getattr(..., None)` defense, causing a silent `TypeError` that killed `_handle_chat_model_end_event`).

7. **Updated 1 test expectation**: `read_file` tool result assertion updated to match `_READ_ONLY_TOOLS` content omission behavior.

8. **Fixed production code import** in `execute_graphton.py`: `from api_pb2 import ExecutionArtifact` → `from artifact_pb2 import ExecutionArtifact` (inline import at line 930, missed during Phase 3).

### Discoveries During Phase 3 Cleanup

- **Task file scope was inaccurate**: Task `T01_3_cleanup_proto_imports.md` estimated "12 tests in TestUsageMetrics" needing rewrite. Reality was 10 tests across 4 classes, with the root cause being MagicMock auto-attribute creation rather than removed fields.
- **`test_git_diff_artifact.py` was already clean**: Task file listed it as needing import fixes, but it had zero `api_pb2` references.
- **MagicMock defeats `getattr` defaults**: `getattr(MagicMock(), "any_attr", None)` returns a MagicMock (not None), because MagicMock auto-creates attributes on access. Setting explicit `None` on the mock is required.

### Files Changed (2 files, +46 -143)

**Modified**:
- `backend/services/agent-runner/tests/test_status_builder.py`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`

## Next Steps

Pick up in this order:

### Next: Phase 3B — Tool Result Truncation & Cost Cap (1-2 days)
**Task file**: `tasks/T01_3B_tool_truncation_and_cost_cap.md`

Two runtime optimization features deferred from Phase 3:
1. Tool result truncation (`max_tool_result_chars`) — prevent oversized tool outputs from inflating context
2. Cost cap checking (`max_cost_usd`) — stop runaway executions. Warn at 80%, terminate at 100%

Both consume `ExecutionConfig` proto fields from Phase 1 and depend on the running cost tracking from Phase 3.

### Then: Remaining T01 Phases
3. **Phase 4: Prompt Caching** — Restructure prompt construction with `cache_control` breakpoints
4. **Phase 5: Server — Usage Report RPCs** — Implement getSessionUsageReport, getAgentUsageReport, getOrgUsageReport
5. **Phase 6: CLI — Usage Display & Commands** — Add `stigmer usage` commands
6. **Phase 7: Sub-Agent Model Routing** — Wire `model_override`

## Context for Resume

- `UsageTracker` is in `backend/services/agent-runner/worker/activities/graphton/usage_tracker.py`. StatusBuilder owns it via `self._usage_tracker`.
- `ModelRegistry.get_by_api_model_id()` resolves provider API model IDs to `ModelMetadata` for pricing. Uses a lazy reverse index.
- `SummarizationEventData` now carries `summarization_input_tokens`, `summarization_output_tokens`, `summarization_cost_usd`.
- `_SummarizationUsageCapture` callback handler captures hidden LLM usage from LangMem's `summarize_messages()`.
- Cost formula: `(regular_input * input_price + output * output_price + cache_creation * creation_price + cache_read * read_price) / 1_000_000`
- LangChain `input_tokens` = total input (including cached). Regular input = `input_tokens - cache_creation - cache_read`.
- Proto stubs were regenerated via `make protos`. All Python imports (production and test) now reference correct `_pb2` modules.
- All 1193 agent-runner tests pass. No known test debt remaining.
- Phase 3 plan: `.cursor/plans/phase_3_usage_metrics_4044b9fe.plan.md`
- Phase 3 Cleanup plan: `.cursor/plans/phase_3_cleanup_a7ef6afe.plan.md`
- T01 master plan: `tasks/T01_0_plan.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260313.01.usage-metrics-cost-optimization/dont-dos/
```

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260313.01.usage-metrics-cost-optimization/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
