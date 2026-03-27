# HITL tool_call_id Research and Interrupt Payload Design

**Date**: March 27, 2026

## Summary

Completed the foundational research task (T01) for the HITL approval flow simplification project. Confirmed that `tool_call_id` — the model-assigned identity for a tool call — is available at LangGraph interrupt time via LangChain's `InjectedToolCallId` annotation. Designed a minimal interrupt payload that reduces the current 8-field payload to 2 fields (`tool_call_id` + `message`), eliminating all redundant data that existed only to support fuzzy matching.

## Problem Statement

The HITL approval flow had a 4-tier fuzzy matching chain (`_run_id_aliases`, fingerprint hashing, name-based fallback, phase-1 enrichment) to correlate LangGraph interrupts with tool calls. This complexity existed because the interrupt payload carried `run_id` (LangGraph's internal ID) instead of `tool_call_id` (the model's ID that matches `ToolCall.id` in messages). Four cascading HITL bugs in a single day traced back to this identity mismatch.

### Pain Points

- `run_id` in the interrupt payload is LangGraph's internal run ID, not the model's `tool_call_id`
- `_run_id_aliases` bridging mechanism adds complexity and is fragile across resume cycles
- Fingerprint matching (SHA256 of name + args) is a workaround, not a proper identity
- 8 fields in the interrupt payload duplicate data already stored on the `ToolCall` in messages
- Sub-agent scoping (`from_sub_agent`, `sub_agent_name`) is unnecessary when the identity is globally unique

## Solution

Two-part research and design outcome:

1. **`InjectedToolCallId` validation**: LangChain's `InjectedToolCallId` annotation (from `langchain_core.tools`) causes the framework to inject the model's `tool_call_id` into the tool function at invocation time. It strips the parameter from the LLM-visible schema. Compatible with the project's langchain-core 1.2.19.

2. **Minimal interrupt payload design**: The interrupt value is reduced to `{tool_call_id, message}`. All other fields (`tool_name`, `tool_args`, `mcp_server`, `source`, `from_sub_agent`, `sub_agent_name`, `run_id`) are removed because they either duplicate data on the `ToolCall` in messages or serve only the fuzzy matching that `tool_call_id` eliminates.

## Implementation Details

### Files investigated

- `graphton/core/tool_wrappers.py` — Current `_check_and_handle_approval` and tool wrapper signatures
- `graphton/core/interrupt_proxy.py` — Sub-agent interrupt forwarding (no changes needed)
- `agent-runner/worker/activities/graphton/status_builder.py` — `_run_id_aliases`, `_fingerprint_to_tool_call_id`
- `agent-runner/worker/activities/graphton/hitl.py` — 4-tier fuzzy matching chain
- LangChain `langchain_core/tools/base.py` — `InjectedToolCallId`, `_parse_input`, `_get_filtered_args`

### Design decisions recorded

- **DD-001**: Single source of truth for tool calls and approvals (pre-existing)
- **DD-002**: Minimal interrupt payload — `{tool_call_id, message}` only

### Implementation approach (for T04)

- Add `tool_call_id: Annotated[str, InjectedToolCallId]` to MCP and platform tool wrappers
- Simplify `_check_and_handle_approval` from 7 params to 4
- Remove `run_id` extraction from `config.get("run_id", "")`
- Sub-agent interrupt proxy forwards `tool_call_id` automatically (dict pass-through)

## Benefits

- Eliminates the 4-tier fuzzy matching chain in `hitl.py` — direct `tool_call_id` lookup
- Eliminates `_run_id_aliases` and `_fingerprint_to_tool_call_id` for HITL matching
- Reduces interrupt payload from 8 fields to 2 — no redundant data
- Simplifies `_check_and_handle_approval` signature from 7 params to 4
- Sub-agent interrupt forwarding requires zero changes

## Impact

- **Python agent-runner**: T04 implementation is fully specified and ready
- **Java/Go servers**: T05 can use `tool_call_id` from interrupt for direct `ToolCall` lookup
- **React SDK**: Downstream simplification enabled by server-side projection
- **All future HITL bugs**: The class of identity-mismatch bugs is structurally eliminated

## Related Work

- Prior HITL fixes: `2026-03-26-174359-fix-hitl-approval-stale-idempotency-short-circuit.md`, `2026-03-26-201753-hitl-approval-flow-hardening.md`, `2026-03-27-094233-hitl-frontend-approval-resilience.md`
- Project: `_projects/2026-03/20260327.01.hitl-approval-cleanup/`

---

**Status**: In Progress (T01 complete, T02-T07 remaining)
**Timeline**: Research phase complete in 1 session
