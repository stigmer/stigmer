# Fix HITL Sequential Approval Prompt Not Appearing

**Date**: February 16, 2026

## Summary

Fixed a bug where the second (and subsequent) HITL approval prompts never appeared in the CLI when an agent performed multiple sequential write operations. The root cause was stale `TOOL_CALL_WAITING_APPROVAL` tool call entries from the DB-loaded status poisoning the post-stream interrupt-to-tool-call matching on the resume path.

## Problem Statement

When an agent execution required multiple write operations (each requiring HITL approval), only the first approval prompt appeared. After approving the first write, the execution resumed and the second write showed "awaiting approval" in the CLI, but the interactive approval prompt (`[a] Approve [s] Skip [r] Reject`) never appeared. The execution stalled indefinitely.

### Pain Points

- **Execution stall**: Users could not approve or reject the second write, leaving the execution stuck in `WAITING_FOR_APPROVAL` with no way to proceed
- **Silent failure**: No error message indicated why the prompt was missing — the CLI simply showed "awaiting approval" without offering any action
- **Affects all sequential writes**: Any agent that writes multiple files (e.g., skill creation, multi-file scaffolding) was affected

## Root Cause

The bug involved three interacting factors across the resume path:

### 1. Stale WAITING_APPROVAL tool calls from DB

When the Python activity resumes after an HITL approval, the `StatusBuilder` is initialized with the DB-persisted status from the previous invocation:

```python
status_builder = StatusBuilder(execution_id, execution.status, approval_config)
```

This loaded status contains the first write's tool call with `TOOL_CALL_WAITING_APPROVAL` status. It was never updated because the previous invocation ended at the interrupt, before the tool could execute. The resume setup code built the LangGraph `Command(resume=...)` but did not update the loaded tool call status to reflect the approval decision.

### 2. Incorrect interrupt-to-tool-call matching

The post-stream interrupt capture code (`execute_graphton.py`) iterates through `current_status.tool_calls` looking for entries with `TOOL_CALL_WAITING_APPROVAL` status:

```python
for tc in status_builder.current_status.tool_calls:
    if (tc.name == tool_name or resolve(tc.name) == tool_name)
        and tc.status == TOOL_CALL_WAITING_APPROVAL
        and tc.id not in matched_tc_ids:
        matched_tool_call_id = tc.id  # First match wins
        break
```

The stale first-write entry (from DB, never updated) matched before the new second-write entry, causing the `PendingApproval` to carry the **old** tool call ID.

### 3. CLI correctly de-duplicated the stale ID

The CLI's `streamToEvents` goroutine tracks prompted IDs to prevent re-prompting:

```go
if pa.ToolCallId == "" || promptedIDs[pa.ToolCallId] {
    continue  // Already prompted — skip
}
```

Since the old tool call ID was already in `promptedIDs` from the first approval cycle, the second approval prompt was silently skipped.

### The cascade

```
StatusBuilder initialized with DB status
  -> tool_calls: [{id: OLD_ID, name: "write_file", status: WAITING_APPROVAL}]

Stream resumes. Second write triggers interrupt.

Post-stream interrupt capture:
  -> Iterates tool_calls looking for WAITING_APPROVAL
  -> OLD entry matches first (stale, never reconciled)
  -> PendingApproval.tool_call_id = OLD_ID

CLI receives status update:
  -> promptedIDs[OLD_ID] == true
  -> SKIPPED — no approval prompt shown
```

## Solution

### 1. Resume State Reconciliation (`execute_graphton.py`)

Added a reconciliation step (Step 7.6) that runs after building the resume command and before starting the stream. For each tool call in the loaded status that has a matching approval decision:

- **APPROVE**: Update status from `WAITING_APPROVAL` to `RUNNING`
- **SKIP**: Update to `SKIPPED`
- **REJECT**: Update to `FAILED`

Also clear `pending_approvals` from the loaded status since they are no longer pending.

This ensures stale `WAITING_APPROVAL` entries cannot be matched by the interrupt capture code.

### 2. Fingerprint Pre-population (`status_builder.py`)

Added `populate_fingerprints_from_existing_tool_calls()` method to `StatusBuilder`. Called during resume setup, it fills the deduplication fingerprint set from existing tool calls in the loaded status. This prevents duplicate tool call entries when LangGraph re-fires `on_tool_start` for resumed tools.

### 3. Phase-save guard fix (`status_builder.py`)

Fixed `_populate_pending_approval()` to save the execution phase only on the **first** pending approval (matching the guard in `set_tool_waiting_approval()`). Previously, it unconditionally overwrote `_saved_phase_before_approval`, which would save `WAITING_FOR_APPROVAL` instead of `IN_PROGRESS` when multiple tool calls required approval in the same response.

## Benefits

- **Sequential approvals work correctly**: All approval prompts appear in order, regardless of how many writes the agent performs
- **No duplicate tool call entries**: Fingerprint pre-population prevents cosmetic duplicates in the status
- **Correct phase restoration**: The phase-save guard ensures `clear_pending_approval()` always restores the correct pre-approval phase

## Impact

### Who is Affected

- **All CLI users** running agents that perform multiple sequential write operations (skill creation, multi-file scaffolding, project generation, etc.)
- The fix is essential for any agent workflow that writes more than one file

### Changed Components

- **Agent Runner** (`execute_graphton.py`): Added resume state reconciliation step
- **Status Builder** (`status_builder.py`): Added `populate_fingerprints_from_existing_tool_calls()`; fixed `_populate_pending_approval()` phase-save guard

### Verification

After the fix, the resume flow becomes:

```
1. Resume setup: OLD tool call updated to RUNNING, pending_approvals cleared
2. Stream: first write on_tool_start deduplicated. Second write processed normally.
3. Interrupt capture: only NEW second write has WAITING_APPROVAL -> correct match
4. PendingApproval.tool_call_id = NEW_ID (not old)
5. CLI: promptedIDs[NEW_ID] == false -> prompt shown
```

---

**Status**: Production Ready
**Files Changed**: 2 core files (`execute_graphton.py`, `status_builder.py`)
**Lines Changed**: ~100 lines of functional code (reconciliation, fingerprint population, phase-save guard)
