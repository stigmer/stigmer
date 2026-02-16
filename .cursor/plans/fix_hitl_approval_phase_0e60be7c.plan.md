---
name: Fix HITL Approval Phase
overview: Fix the HITL approval interrupt flow by resolving a tool name mismatch between the status_builder (which sees the LangGraph event tool name "write_file") and the approval policy (which only recognizes the canonical platform tool name "write"), causing the execution phase to never be set to WAITING_FOR_APPROVAL.
todos:
  - id: add-alias-resolution
    content: Add PLATFORM_TOOL_ALIASES dict, resolve_platform_tool_name() helper, and update is_platform_tool() and resolve_tool_approval() in approval_policy.py
    status: completed
  - id: fix-interrupt-matching
    content: Update post-stream interrupt-to-tool-call matching in execute_graphton.py to use alias-aware name comparison
    status: completed
isProject: false
---

# Fix HITL Approval Interrupt Flow

## Root Cause

There is a **tool name mismatch** between two independent approval checks:

1. **Status builder** receives the LangGraph `on_tool_start` event with `tool_name="write_file"` (the alias name registered as a LangChain tool). It calls `resolve_tool_approval("write_file", ...)`, which checks `is_platform_tool("write_file")`. Since `PLATFORM_TOOL_DEFAULTS` only contains `"write"` (not `"write_file"`), the check falls through to "No policy matched" and returns `NOT_REQUIRED source=none`. The tool call is created with `TOOL_CALL_RUNNING` status, and the phase stays `IN_PROGRESS`.
2. **Tool wrapper** (the actual function body inside `_create_write_tool`) calls `_check_and_handle_approval("write", tool_args, approval_checker)` with the **hardcoded canonical name** `"write"`. The approval policy recognizes `"write"` in `PLATFORM_TOOL_DEFAULTS`, returns `REQUIRED source=platform_default`, and calls `interrupt()`.

The stream ends due to the interrupt, but the status_builder never set the phase to `WAITING_FOR_APPROVAL`. The post-stream phase-determination logic at line 2480 of `execute_graphton.py` checks `if current_phase == WAITING_FOR_APPROVAL` -- it is not, so it falls to the `else` branch and sets `EXECUTION_COMPLETED`.

### Evidence from logs

```
[APPROVAL] tool=write_file server= result=NOT_REQUIRED source=none      <-- status_builder (wrong!)
[TOOL] ... tool=write_file run_id=... status=TOOL_CALL_RUNNING           <-- never set to WAITING_APPROVAL
[APPROVAL] tool=write server= result=REQUIRED source=platform_default    <-- tool wrapper (correct)
Tool 'write' requires approval (source=platform_default)
Interrupting execution for approval: tool=write
```

The same bug affects `edit_file` (alias for `edit`) and potentially `read_file` (alias for `read`, though read is not approval-required).

## Fix

### File 1: `[approval_policy.py](backend/services/agent-runner/worker/activities/graphton/approval_policy.py)`

Add platform tool alias resolution so that `write_file` resolves to `write`, `edit_file` resolves to `edit`, and `read_file` resolves to `read` before checking `PLATFORM_TOOL_DEFAULTS`.

- Add a `PLATFORM_TOOL_ALIASES` dictionary mapping alias names to canonical names:

```python
PLATFORM_TOOL_ALIASES: dict[str, str] = {
    "read_file": "read",
    "write_file": "write",
    "edit_file": "edit",
}
```

- Add a `resolve_platform_tool_name(tool_name: str) -> str` helper that returns the canonical name.
- Update `is_platform_tool()` to resolve aliases first.
- Update `resolve_tool_approval()` (lines 411-441) to resolve the alias before the `PLATFORM_TOOL_DEFAULTS` lookup:

```python
resolved_name = resolve_platform_tool_name(tool_name)
if resolved_name in PLATFORM_TOOL_DEFAULTS:
    platform_config = PLATFORM_TOOL_DEFAULTS[resolved_name]
    ...
```

### File 2: `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`

Fix the post-stream interrupt-to-tool-call matching (lines 2410-2422). Currently it matches `tc.name == tool_name`, but the interrupt payload has `tool_name="write"` (canonical) while the tool call has `tc.name="write_file"` (alias from LangGraph event). Add alias-aware matching:

```python
from worker.activities.graphton.approval_policy import resolve_platform_tool_name

# Inside the matching loop:
tc_canonical = resolve_platform_tool_name(tc.name)
if (
    (tc.name == tool_name or tc_canonical == tool_name)
    and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
    and tc.id not in matched_tc_ids
):
```

### No changes needed

- `**status_builder.py**`: No changes needed. `_check_tool_approval_requirement()` already delegates to `resolve_tool_approval()`, which will now correctly resolve aliases.
- `**tool_wrappers.py**`: No changes needed. The hardcoded `"write"` in `_check_and_handle_approval("write", ...)` is correct -- it is the canonical tool name, and the approval policy already handles it.
- **Go/Java workflows**: No changes needed. The workflow correctly enters the HITL loop when the phase is `WAITING_FOR_APPROVAL`, which the agent-runner will now correctly set.
- **CLI**: No changes needed. The CLI already has the `ToolWaitingApprovalEvent` handling from earlier work.

## Verification

After the fix, the expected log sequence will be:

```
[APPROVAL] tool=write_file server= result=REQUIRED source=platform_default   <-- resolved via alias
[TOOL] ... tool=write_file run_id=... status=TOOL_CALL_WAITING_APPROVAL      <-- correct initial status
[APPROVAL] ... tool=write_file run_id=... status=WAITING_APPROVAL            <-- phase set correctly
[APPROVAL] tool=write server= result=REQUIRED source=platform_default        <-- tool wrapper (still fires)
Interrupting execution for approval: tool=write
Stream ended with WAITING_FOR_APPROVAL phase                                  <-- preserved, not overwritten
[FINAL] Sending EXECUTION_WAITING_FOR_APPROVAL status update                 <-- correct phase sent
```

