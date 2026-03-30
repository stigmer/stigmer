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
**Current Task**: All tasks complete + environment cleanup
**Status**: T01, T02, T03, T04 complete; environment legacy paths removed

## Session Progress (2026-03-30)

### Session 1: T01 Completed — Quick Wins
- **S5**: Added `_LANGGRAPH_UNLIMITED_RECURSION` named constant, replaced magic number
- **S3**: Extracted `_persist_and_return_failed_status()` helper, deduplicated two error handlers
- **S4**: Extracted `InlinePublisher` class from 64-line closure into `graphton/inline_publisher.py`
- **Tests**: 9 new unit tests for InlinePublisher; all 1,382 tests pass
- **Impact**: execute_graphton.py 2,184 → 2,127 lines (-57 net, ~110 lines of logic extracted/deduplicated)

### Session 1 Surprise Discovered & Resolved
- Original plan said to stop passing `recursion_limit` to `create_deep_agent()`, but graphton uses it for `ExecutionBudgetMiddleware` configuration (threshold mode vs periodic mode). Removing it would have been a behavioral change. Kept the pass-through unchanged; S5 became a smaller named-constant-only change.

### Session 2: T02 Completed — LangGraph v2 tool_call_id Research
- **12 tests written** in `graphton/tests/core/test_tool_call_id_on_events.py` (10 deterministic + 2 real Anthropic LLM)
- **All pass** against langgraph==1.0.8, langchain-core==1.2.12
- **Findings confirmed**:
  1. v2 `astream_events` do NOT carry `tool_call_id` on `on_tool_start` / `on_tool_end` events
  2. LangChain callback API (`BaseCallbackHandler.on_tool_start`) DOES receive `tool_call_id` as a kwarg
  3. Sync callbacks fire BEFORE the corresponding v2 event (critical for ToolCallIdCapture timing)
  4. Multiple tool calls each get correct `tool_call_id` via callback
  5. Resume after interrupt preserves `tool_call_id` in callback
  6. Real Anthropic model (`claude-sonnet-4-20250514`) confirms same behavior
- **Conclusion**: `ToolCallIdCapture` is still necessary. The primary identity path works. Bidirectional fallback is compensating complexity, not a safety net for a broken mechanism.

### Session 3: T03 Completed — HITL Bidirectional Fallback Elimination
- **Deleted 40 lines** of bidirectional fallback matching from execute_graphton.py (lines 1722-1761)
- **Replaced with 6-line observability warning** that logs `[RESUME_UNMATCHED]` at ERROR level when decisions fail to match interrupts, surfacing identity chain failures instead of masking them
- **Deleted `TestBidirectionalIdLookup`** test class (3 tests, ~120 lines) from test_hitl_contracts.py
- **Updated module docstring** to remove bidirectional ID lookup reference
- **All 1,379 tests pass** (1,382 - 3 deleted tests for deleted behavior)
- **Impact**: execute_graphton.py 2,127 → 2,097 lines (-30 net). test_hitl_contracts.py -123 lines. Total: -154 lines.
- **What stayed the same**: ToolCallIdCapture aliases, ResumeReconciler, tool_event.py identity dedup, primary matching loop, zero-match error handling

### Session 4: T04 Completed — Extract Setup Phase & Parallelize gRPC Fetches
- **Created `graphton/setup.py`** (1,348 lines): `SetupResult` frozen dataclass + `perform_setup()` async function containing the entire setup pipeline extracted from `_execute_graphton_impl`
- **Extended `graphton/hitl.py`** (263 → 505 lines, +242): Added `ResumeResult` dataclass + `resolve_resume_input()` function encapsulating HITL resume detection, interrupt matching, ResumeReconciler, orphan reconciliation, and task tool resume queue. Moved `_build_decision_value`, `_summarize_resume_entry`, `_ACTION_MAP` from execute_graphton.py
- **Rewrote `_execute_graphton_impl`** as thin orchestrator: crash recovery → `perform_setup()` → `resolve_resume_input()` → `StreamExecutor` → `process_post_stream()` → final status
- **Parallelized gRPC fetches** using `asyncio.gather`: environment resolution, skill fetch, and MCP server fetch now run concurrently after chain resolution, saving ~2 gRPC round-trips of latency. MCP fetch is non-fatal (continues with empty config on error)
- **Partial-resource cleanup**: `perform_setup()` wraps `_perform_setup_core()` with try/except to clean up workspace_backend and MCP middleware if setup fails partway
- **All 1,379 tests pass**
- **Impact**:

| Metric | Before T04 | After T04 |
|---|---|---|
| `execute_graphton.py` total | 2,097 | 621 (70% reduction) |
| `_execute_graphton_impl` body | ~1,783 | 386 (78% reduction) |
| New `setup.py` | 0 | 1,348 |
| `hitl.py` | 263 | 505 (+242) |
| Net lines across all files | -- | ~0 (reshuffled) |
| Setup latency | serial | ~2 RTT saved |

- **Design decisions**:
  - Used function + frozen dataclass pattern (not class) for setup extraction, matching project patterns (`resolve_environment()` + `EnvironmentResult`, `process_post_stream()` + `PostStreamResult`)
  - HITL resume extracted separately from setup because its early-return failure path would add accidental complexity to setup
  - Re-exports in execute_graphton.py preserve backward compat for tests importing `_build_decision_value`, `_summarize_resume_entry`, etc.
  - `grpc_provider`, `exit_stack`, `execution_client`, `retry_executor` created in orchestrator (not in setup) so the error handler and finally block always have access regardless of setup success

### Session 4 Follow-up: Environment Resolution Cleanup
- **Simplified `graphton/environment.py`** (141 → 78 lines): Removed legacy 3-layer fallback (agent `env_spec` + `environment_refs` + `runtime_env`). ExecutionContext is now the only path — absent ExecutionContext raises `ValueError` instead of silently falling back
- **Deleted `grpc_client/environment_client.py`** (197 lines): The `EnvironmentClient` gRPC client that directly queried `Environment` resources is no longer needed. Agent runner no longer interacts with the `Environment` resource directly
- **Simplified `setup.py`**: Removed `_get_environment_client_class()` helper, simplified `_fetch_environment()` signature (dropped `agent`, `agent_instance`, `execution` params), removed `EnvironmentClient` TYPE_CHECKING import
- **Removed `EnvironmentResult.used_legacy_merge`** field and heartbeat payload reference
- **All 1,379 tests pass**
- **Rationale**: ExecutionContext is always created by the workflow with pre-merged env vars before the activity starts. It persists until execution termination. The legacy paths were dead code — the agent runner should never directly query `Environment` resources

## Next Steps

All planned tasks (T01–T04) are complete. Possible follow-ups:
- Consider further decomposition of the 386-line `_execute_graphton_impl` (streaming + post-stream + error handler account for most of it, but they're already delegated to extracted modules)
- Profile the parallel fetch in production to measure actual RTT savings

## Context for Resume

- T01, T02, T03 changes are committed on branch `feat/execute-graphton-hardening`
- T04 + environment cleanup changes are uncommitted on the same branch
- Knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos) are still empty

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
