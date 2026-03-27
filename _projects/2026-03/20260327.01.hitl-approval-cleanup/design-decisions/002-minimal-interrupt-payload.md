# Design Decision 002: Minimal Interrupt Payload

**Date**: 2026-03-27
**Status**: Approved
**Context**: T01 research confirmed tool_call_id is available via InjectedToolCallId. Decided interrupt payload scope.

## Decision

The LangGraph interrupt payload for HITL approval is reduced from 8 fields to 2:

```python
approval_request = {
    "tool_call_id": tool_call_id,
    "message": requirement.message,
}
```

### Fields removed (and why)

| Field | Reason for removal |
|-------|-------------------|
| `run_id` | Replaced by `tool_call_id` — the model-assigned identity, not LangGraph's internal run ID |
| `tool_name` | Already on `ToolCall` in `messages[].tool_calls[]`, created before `interrupt()` fires |
| `tool_args` | Already on `ToolCall` in messages; fingerprint matching eliminated by direct ID |
| `mcp_server` | Already on `ToolCall` in messages |
| `source` | Already on `ToolCall` in messages |
| `from_sub_agent` | `tool_call_id` is globally unique — scoping by sub-agent is unnecessary |
| `sub_agent_name` | Already on `SubAgentExecution` that contains the ToolCall |

### Fields kept (and why)

| Field | Reason for keeping |
|-------|-------------------|
| `tool_call_id` | The single identity for the tool call. Injected via `InjectedToolCallId`. |
| `message` | The human-readable approval reason computed by `approval_checker()` at interrupt time. Not stored on `ToolCall` today. Stays in interrupt until `ToolCall` proto gains `approval_message` field (T02/T03). |

## Rationale

1. **No backward compatibility.** `run_id` is deleted, not kept alongside `tool_call_id`. There is one identity and it is `tool_call_id`. No consumer depends on `run_id` in the interrupt value.

2. **No redundancy.** Every display field (`tool_name`, `tool_args`, `mcp_server`, `source`, `sub_agent_name`) already exists on the `ToolCall` in `messages[].tool_calls[]`. The `ToolCall` is created by `on_tool_start` / `on_chat_model_stream` **before** `interrupt()` is called. Duplicating data into the interrupt value creates a second copy that can drift — the exact class of bug this project eliminates.

3. **`_check_and_handle_approval` signature simplified.** From 7 parameters (`tool_name`, `tool_args`, `approval_checker`, `mcp_server`, `from_sub_agent`, `sub_agent_name`, `run_id`) to 4 (`tool_name`, `tool_args`, `approval_checker`, `tool_call_id`).

## Consequences

- `hitl.py` `InterruptCapture._match_interrupt` can become a direct `tool_call_id` lookup — the 4-tier fuzzy matching chain (run_id alias, fingerprint, name, phase1 enrichment) is deleted.
- `status_builder.py` `_run_id_aliases` and `_fingerprint_to_tool_call_id` become unnecessary for HITL matching (they may still serve other purposes like tool event routing).
- Sub-agent interrupt proxy (`interrupt_proxy.py`) requires no changes — it forwards interrupt value dicts as-is.
