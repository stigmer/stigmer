# Workflow Domain Tech Debt Sweep

**Date**: May 16, 2026

## Summary

Resolved 4 accumulated tech debt items from the Workflow Domain "Bring Workflows to the Foreground" project (Phases 0-3). Fixed a TS SDK codegen import resolution bug that would silently break on the next `make codegen` run, implemented OSS event persistence to close a dual-implementation behavioral divergence, wrote and wired budget validation warnings, and verified search indexing correctness. Two items (unified artifact downloads, usage page) were investigated and deferred with documented rationale.

## Problem Statement

Over the course of 16 tasks across 4 phases, the Workflow Domain project accumulated 7 tech debt items that ranged from architectural violations (OSS/Cloud behavioral divergence) to codegen tooling bugs and unverified behavior. These needed resolution before Phase 4 (Advanced Agentic Orchestration) introduced more complexity on top.

### Pain Points

- TS SDK codegen silently produced wrong import paths for cross-package types (`serverless/io_pb` instead of `serverless/validation_pb`), masked by a manual patch that would be overwritten on the next codegen run
- OSS `stigmer-server` silently dropped workflow execution events sent by `workflow-runner`, while the Java/Cloud handler persisted them — a core feature behavioral divergence
- `CheckBudgetWarnings` was planned in T05 but never implemented — users got no feedback on budget misconfigurations before running a workflow
- Workflow search indexing was flagged as "unverified" with no test coverage

## Solution

Investigated all 7 items against the actual codebase, prioritized by architectural severity, and resolved the 4 actionable items. Two items (unified `artifact.v1` downloads, usage page unification) were investigated, found to be either already working via parallel mechanisms or unverifiable without frontend code, and deferred with documented rationale.

## Implementation Details

### TD-2 + TD-3: TS SDK Codegen Fix

**Root cause**: `tsImportMethodType` in `tools/codegen/generator/sdk_client_ts.go` blindly appended `/io_pb` for cross-package types instead of consulting `methodTypeFileMap` which already carried the correct mapping from `workflow.json`.

**Fix**: 4-line change in the cross-package branch — check `methodTypeFileMap[typeName]` before the `/io_pb` fallback. Verified by running `make -C sdk/typescript codegen` and confirming the generated `workflow.ts` now imports `ServerlessWorkflowValidation` from the correct `serverless/validation_pb` path.

### TD-1: OSS Event Persistence

- **SQLite migration** (`schemaVersion5`): New `workflow_execution_events` table with `(execution_id, sequence_number)` composite primary key and indexes for event type and task name filtering
- **Store interface**: 3 new methods (`AppendWorkflowExecutionEvents` with monotonic sequence enforcement, `GetWorkflowExecutionEvents` with cursor-based pagination, `GetMaxEventSequence`) plus `WorkflowExecutionEventRecord` struct
- **PersistEventsStep**: New pipeline step in `update_status.go`, wired after status persistence. Non-fatal — logs warnings on failure but does not break the pipeline
- **GetEventLog**: New query handler with cursor-based pagination, multi-type filtering, and `has_more` flag
- **SubscribeEvents**: New streaming handler with poll-based approach (500ms), initial replay from `after_sequence`, and terminal state detection

### TD-4: CheckBudgetWarnings

- **Wrote from scratch** in `budget_warnings.go` (147 lines) — 7 warning scenarios: zero budget with terminate policy, zero tokens with terminate, budget without cost-bearing tasks, no budget with cost-bearing tasks, missing `on_exceeded` policy, extremely low duration, per-task costs exceeding workflow budget
- **Wired into ValidateWorkflow** Temporal activity as Step 4, appends to `ServerlessWorkflowValidation.warnings`, non-blocking (state stays `VALID`)
- **9 unit tests** in `budget_warnings_test.go`, all passing

### TD-7: Search Indexing Verification

Verified code path is correct: `IndexSearchStep` is wired at step 9 of the workflow create pipeline, `WorkflowExtractor` produces search index entries. The best-effort indexing pattern is a platform-wide design choice shared across all searchable resource kinds (agents, workflows, skills, MCP servers), not a workflow-specific gap.

## Benefits

- **Codegen durability**: Next `make codegen` run no longer silently breaks the dashboard or workflow validation. Any future RPC returning a type from a sub-package will also resolve correctly.
- **OSS/Cloud parity**: Workflow execution events are now persisted in the OSS edition, matching the Java/Cloud handler's behavior. The execution viewer can display event timelines in both editions.
- **Authoring feedback**: Users creating workflows with budget configurations now receive actionable warnings about misconfigurations before the workflow runs.
- **Confidence**: Search indexing verified as correctly wired; best-effort pattern documented as a known platform-level design choice.

## Impact

- **Backend (Go)**: Store interface extended (3 methods), SQLite migration (v5), 2 new gRPC query handlers, 1 new pipeline step, 1 new validation function with tests
- **Codegen tooling**: Import resolution fix affects all future cross-package type resolutions
- **Repos**: stigmer (OSS) only — no stigmer-cloud changes required

## Related Work

- Parent project: `20260508.01.bring-workflows-to-foreground` (Phases 0-3 complete)
- Sub-project: `20260515.01.sp.agent-powered-workflow-generation` (all batches complete)
- Deferred: TD-5 (unified `artifact.v1` service) tracked as future feature work
- Deferred: TD-6 (usage page unification) requires frontend code verification

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
