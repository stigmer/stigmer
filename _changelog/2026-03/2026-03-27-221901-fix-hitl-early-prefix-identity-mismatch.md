# Fix HITL Approval Resume: `early-` Prefix Identity Mismatch

**Date**: March 27, 2026

## Summary

Fixed the HITL approval "amnesia" bug where agents forgot approved actions and restarted from scratch after every approval. The root cause was an `early-` prefix on tool call IDs in the StatusBuilder that prevented the resume code from matching approval decisions to LangGraph interrupt checkpoints.

## Problem Statement

After a user approved a tool call (e.g., `write mcp-server-stigmer.yaml`), the agent would lose context and re-attempt the exact same operation — as if the approval and execution never happened. The agent appeared to have amnesia.

### Pain Points

- Approved file writes were repeated, causing confusion and wasted time
- The agent execution loop never progressed past the first approval-gated tool call
- Production logs showed: `[RESUME] 1 approval_decision(s) present but no matching interrupts found in checkpoint. Proceeding with fresh execution.`

## Solution

Eliminated the `early-` prefix from model-provided tool call IDs in the StatusBuilder, unifying the identity used across all three systems that track a tool call:

| System | Before | After |
|---|---|---|
| LangGraph interrupt payload | `toolu_01J1r...` (raw) | `toolu_01J1r...` |
| StatusBuilder / Messages / DB | `early-toolu_01J1r...` | `toolu_01J1r...` |
| LangGraph run_id | UUID (aliased) | UUID (aliased) |

## Implementation Details

**Single-line change** in `status_builder.py`, `_create_early_tool_call()` (line 1707):

- **Before**: `temp_id = f"early-{tool_use_id or uuid4()}"`
- **After**: `temp_id = tool_use_id or f"early-{uuid4()}"`

When the model provides a `tool_use_id` (the normal path), use it directly as the `ToolCall.id`. The `early-` prefix is retained only for the UUID fallback case (when no model ID is available), where it serves as a display placeholder that can't match an interrupt anyway.

No changes required in:

- `_reconcile_early_tool_call` — matches by tool name + sub-agent context, not by ID prefix
- `_handle_tool_start_event` — fingerprint dedup and reconciliation are ID-agnostic
- `execute_graphton.py` resume matching — the join now works because both sides carry the raw model ID
- Tests — no assertions referenced `early-` prefixed strings

## Benefits

- Approval resume flow works correctly: decisions match interrupts on the first attempt
- Single identity for each tool call across all layers — no more identity split
- Zero risk of future code comparing IDs across system boundaries and hitting the mismatch
- No backward-compatibility concerns: in-flight broken executions were already failing

## Impact

- **Agent Runner**: `status_builder.py` — the core streaming status tracker
- **End Users**: Approval-gated tool calls now resume correctly instead of restarting
- **Developers**: Eliminates a class of ID-mismatch bugs from the HITL flow

## Related Work

- [T04: InjectedToolCallId interrupt injection](2026-03-27-183939-hitl-tool-call-id-interrupt-injection.md) — made the raw model ID available in interrupt payloads
- [T03: Single writer HITL simplification](2026-03-27-195043-python-single-writer-hitl-simplification.md) — simplified the approval state management
- [T07: HITL test rewrite](2026-03-27-213854-t07-hitl-test-rewrite.md) — comprehensive test coverage for the new architecture

---

**Status**: ✅ Production Ready
**Timeline**: Part of the HITL approval cleanup project (20260327.01)
