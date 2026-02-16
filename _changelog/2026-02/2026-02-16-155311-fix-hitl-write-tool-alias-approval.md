# Fix HITL Approval Interrupt Flow for Write Tool Aliases

**Date**: February 16, 2026

## Summary

Fixed a critical bug in the Human-In-The-Loop (HITL) approval flow that prevented write approval prompts from appearing in the CLI. The issue was caused by a tool name mismatch between the status builder (which saw the LangGraph event name "write_file") and the approval policy (which only recognized the canonical name "write"). This resulted in executions being incorrectly marked as `COMPLETED` instead of `WAITING_FOR_APPROVAL`, causing files to never be written and artifacts to never be published.

## Problem Statement

When an agent attempted to write files using the `write_file` tool (a LangChain alias for the canonical `write` tool), the HITL approval prompt never appeared in the CLI. Instead, the execution immediately completed with status `EXECUTION_COMPLETED`, even though:

1. The tool wrapper correctly called `interrupt()` to pause execution
2. The LangGraph checkpoint was saved
3. No file was actually written

This affected all tool aliases: `write_file`, `edit_file`, and `read_file`.

### Pain Points

- **User experience**: Users never saw approval prompts for write operations, leading to confusion about why files weren't being created
- **Data loss**: Work was lost because files were never written and artifacts were never published
- **Silent failures**: The execution appeared to complete successfully (status `COMPLETED`) when it should have been waiting for approval
- **Platform reliability**: HITL approval, a core safety feature, was completely broken for aliased tool names

## Root Cause

The bug stemmed from **two independent approval checks** using different tool names:

1. **Status Builder** (processes LangGraph events):
   - Receives `on_tool_start` event with `tool_name="write_file"` (the alias name registered as a LangChain tool)
   - Calls `resolve_tool_approval("write_file", ...)`
   - Checks `is_platform_tool("write_file")` → returns `False` (only "write" was in `PLATFORM_TOOL_DEFAULTS`)
   - Falls through to "No policy matched" → returns `NOT_REQUIRED source=none`
   - Tool call created with status `TOOL_CALL_RUNNING` (not `WAITING_APPROVAL`)
   - Execution phase stays `IN_PROGRESS`

2. **Tool Wrapper** (actual function implementation):
   - Function body calls `_check_and_handle_approval("write", ...)` with the **hardcoded canonical name**
   - Approval policy recognizes "write" → returns `REQUIRED source=platform_default`
   - Calls `interrupt()` to pause execution

**Result**: The stream ended due to the interrupt, but the status_builder never set the phase to `WAITING_FOR_APPROVAL`. The post-stream phase-determination logic checked `if current_phase == WAITING_FOR_APPROVAL` — it was not, so it set `EXECUTION_COMPLETED`.

### Evidence from Logs

```
[APPROVAL] tool=write_file server= result=NOT_REQUIRED source=none      <-- status_builder (wrong!)
[TOOL] ... tool=write_file run_id=... status=TOOL_CALL_RUNNING           <-- never set to WAITING_APPROVAL
[APPROVAL] tool=write server= result=REQUIRED source=platform_default    <-- tool wrapper (correct)
Tool 'write' requires approval (source=platform_default)
Interrupting execution for approval: tool=write
Stream finished — processed 2043 events
[FINAL] Sending EXECUTION_COMPLETED status update                         <-- BUG: should be WAITING_FOR_APPROVAL
```

## Solution

Added platform tool alias resolution to ensure both the status_builder and tool wrapper agree on approval requirements. The fix resolves tool name aliases (`write_file` → `write`, `edit_file` → `edit`, `read_file` → `read`) before checking approval policies.

### Implementation Details

#### 1. Alias Resolution in `approval_policy.py`

Added alias mapping and resolution helper:

```python
PLATFORM_TOOL_ALIASES: dict[str, str] = {
    "read_file": "read",
    "write_file": "write",
    "edit_file": "edit",
}

def resolve_platform_tool_name(tool_name: str) -> str:
    """Resolve a platform tool alias to its canonical name."""
    return PLATFORM_TOOL_ALIASES.get(tool_name, tool_name)
```

Updated `is_platform_tool()` to resolve aliases first:

```python
def is_platform_tool(tool_name: str) -> bool:
    return resolve_platform_tool_name(tool_name) in PLATFORM_TOOL_DEFAULTS
```

Updated `resolve_tool_approval()` to resolve aliases before policy lookup:

```python
resolved_name = resolve_platform_tool_name(tool_name)
if resolved_name in PLATFORM_TOOL_DEFAULTS:
    platform_config = PLATFORM_TOOL_DEFAULTS[resolved_name]
    # ...
```

#### 2. Alias-Aware Interrupt Matching in `execute_graphton.py`

Updated post-stream interrupt-to-tool-call matching to handle name mismatches:

```python
from worker.activities.graphton.approval_policy import resolve_platform_tool_name

# Inside interrupt matching loop:
tc_canonical = resolve_platform_tool_name(tc.name)
if (
    (tc.name == tool_name or tc_canonical == tool_name)
    and tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL
    and tc.id not in matched_tc_ids
):
```

This ensures that an interrupt payload with `tool_name="write"` (canonical) correctly matches a tool call with `tc.name="write_file"` (alias from LangGraph event).

## Benefits

- **HITL approval works correctly**: Users now see approval prompts for write operations as designed
- **Consistent behavior**: Both `write` and `write_file` tool names now have identical approval behavior
- **No data loss**: Files are written and artifacts are published after approval
- **Correct execution phases**: Executions properly transition to `WAITING_FOR_APPROVAL` instead of completing prematurely
- **Platform reliability**: Core safety feature (HITL approval) is restored

## Impact

### Who is Affected

- **All users** using agents with write tools enabled (the default configuration)
- **Platform safety**: Restores the intended HITL approval gate for dangerous operations

### Changed Components

- **Agent Runner** (Python): `approval_policy.py`, `execute_graphton.py`
- **Status Builder** (Python): Approval requirement resolution now alias-aware
- **HITL Flow**: Interrupt detection and matching now alias-aware

### Verification

After the fix, the expected log sequence is:

```
[APPROVAL] tool=write_file server= result=REQUIRED source=platform_default   <-- resolved via alias
[TOOL] ... tool=write_file run_id=... status=TOOL_CALL_WAITING_APPROVAL      <-- correct initial status
[APPROVAL] ... tool=write_file run_id=... status=WAITING_APPROVAL            <-- phase set correctly
[APPROVAL] tool=write server= result=REQUIRED source=platform_default        <-- tool wrapper (still fires)
Interrupting execution for approval: tool=write
Stream ended with WAITING_FOR_APPROVAL phase                                  <-- preserved, not overwritten
[FINAL] Sending EXECUTION_WAITING_FOR_APPROVAL status update                 <-- correct phase sent
```

## Related Work

- Prior diagnostic work added extensive logging to trace the approval flow (Go workflow, CLI event handling)
- The original HITL approval implementation was correct for canonical tool names but didn't account for LangChain tool aliasing
- This fix completes the HITL approval flow implementation by handling the alias mismatch

---

**Status**: ✅ Production Ready  
**Files Changed**: 2 core files (`approval_policy.py`, `execute_graphton.py`)  
**Lines Changed**: +60 lines of functional code (alias resolution and matching logic)
