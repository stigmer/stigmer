# SubAgentExecution Proto Model Enhancements

**Date**: March 10, 2026

## Summary

Enhanced the `SubAgentExecution` protobuf model and `SubAgentStatus` enum to support sub-agent-scoped pending approvals and cancellation lifecycle. Established four foundational design decisions (DD-01 through DD-04) that shape how sub-agent execution data flows from the runner through proto to the CLI, eliminating redundant LLM calls, anemic domain models, and confusing UI labels.

## Problem Statement

The sub-agent execution model had several gaps that created an inconsistent experience across the platform's proto contracts, Python runner, and Go CLI layers.

### Pain Points

- `SubAgentExecution.subject` was documented as LLM-generated, adding latency and cost when the invoking LLM already provides a concise `description` argument
- No way to surface pending tool approvals scoped to a specific sub-agent — approvals were only visible at the parent `AgentExecutionStatus` level
- No `CANCELLED` status for sub-agents, leaving them stuck in `IN_PROGRESS` when the parent execution is cancelled
- The CLI displayed "Task:" as the label for sub-agent invocations, which is a LangGraph internal tool name, not a user-facing concept
- Defensive fallback chains in CLI rendering (subject -> metadata description -> name -> input) created unpredictable display behavior

## Solution

A proto-first approach: land the model changes and regenerate stubs (PR1), then update the runner (PR2) and CLI (PR4) in subsequent PRs. Four design decisions were captured to guide downstream work.

## Implementation Details

### Proto Changes

**`SubAgentExecution` message** (`api.proto`):
- Updated `subject` (field 13) documentation — now describes direct population from the task tool's `description` argument, with no LLM generation
- Added `repeated PendingApproval pending_approvals = 14` — surfaces approval requests scoped to this sub-agent, mirroring the parent-level pattern

**`SubAgentStatus` enum** (`enum.proto`):
- Added `SUB_AGENT_CANCELLED = 5` with a full status transition diagram in the enum header
- Documents when the status applies (parent cancelled while sub-agent active) and what fields are populated (`completed_at`, `error`)

### Design Decisions

- **DD-01**: `SubAgentExecution` IS the domain entity for "task" tool invocations. No separate `ToolCall` or `parent_tool_call_id` needed — Gap 2 from the original plan dropped entirely
- **DD-02**: `subject` populated directly from `tool_args.get("description", "")`, eliminating the `_generate_sub_agent_subject()` LLM call
- **DD-03**: CLI label "Task" renamed to "Sub-agent" across all three render paths and the `toolDisplayMap`
- **DD-04**: No fallback/defensive code for empty `subject` — if the runner doesn't populate it, CLI shows empty

## Benefits

- **Reduced latency**: Eliminating the economy-tier LLM call for subject generation removes a network round-trip from every sub-agent start
- **Sub-agent approval isolation**: Consumers can query a single sub-agent's approval state without scanning the parent's full list
- **Clean lifecycle**: `SUB_AGENT_CANCELLED` prevents sub-agents from remaining in `IN_PROGRESS` indefinitely in persisted status
- **Predictable UX**: Removing fallback chains and renaming "Task" to "Sub-agent" gives users a consistent, domain-accurate display

## Impact

- **Proto consumers**: Go and Python stubs regenerated. New field and enum value are additive — existing serialized data deserializes correctly with zero-value defaults
- **Runner** (PR2): Will remove `_generate_sub_agent_subject()` and populate `subject` from `description` arg directly
- **CLI** (PR4): Will rename "Task" to "Sub-agent" and remove fallback logic for empty subject
- **Wire compatibility**: Fully backward-compatible. No field numbers or names changed

## Related Work

- Part of project `20260309.01.sub-agent-execution-streamline`
- PR1 of a 5-PR sequence (PR2: runner, PR3: namespace robustness, PR4: CLI, PR5: tests)
- Design decisions documented in `_projects/2026-03/20260309.01.sub-agent-execution-streamline/design-decisions/`

---

**Status**: Production Ready
**Timeline**: PR1 complete; PR2-PR5 pending
