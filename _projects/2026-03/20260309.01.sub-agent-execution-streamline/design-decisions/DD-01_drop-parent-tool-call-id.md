# DD-01: Drop `parent_tool_call_id` and Gap 2 Entirely

**Date**: 2026-03-09
**Status**: ACCEPTED

## Decision

`SubAgentExecution` IS the domain entity for the "task" tool invocation. Creating a separate `ToolCall` for the "task" tool and linking it via `parent_tool_call_id` is an anemic model — it duplicates a richer domain entity with a hollow shell.

## Evidence

- `SubAgentExecution` already has: `id` (matches LangGraph run_id), `input`, `output`, `status`, `started_at`, `completed_at`, `error`, `tool_calls`, `messages`, `usage`
- The Python runner already skips ToolCall creation for "task" tools (`return` at line 611 of `status_builder.py`)
- The CLI already suppresses "task" tool events via `IsTaskTool()` checks (`run_stream_inline.go` lines 334-345)
- Any analytics needing sub-agent invocation counts should query `status.sub_agent_executions`, not `status.tool_calls`

## Impact

- Gap 2 from `T01_0_plan.md` is **DROPPED**
- No `parent_tool_call_id` field added to the proto
- No runner changes to create "task" ToolCalls
- The existing `return` in `_process_tool_start` (line 611) remains correct — "task" tool invocations produce `SubAgentExecution` entries, not `ToolCall` entries
