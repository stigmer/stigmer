---
name: Fix HITL second approval prompt
overview: Fix the bug where sequential HITL write approvals fail to show the second approval prompt. The root cause is stale tool call entries from the DB-loaded status interfering with interrupt-to-tool-call matching on the resume path.
todos:
  - id: reconcile-approved-tool-calls
    content: "Add resume state reconciliation in execute_graphton.py: update old tool call statuses and clear pending_approvals after building resume command"
    status: completed
  - id: populate-fingerprints
    content: Add populate_fingerprints_from_status() method to StatusBuilder and call it during resume setup
    status: completed
  - id: fix-phase-save-guard
    content: Fix _populate_pending_approval to use the same phase-save guard as set_tool_waiting_approval (save only on first pending)
    status: completed
  - id: add-changelog
    content: Write a changelog entry documenting the fix
    status: completed
isProject: false
---

# Fix HITL Second Approval Prompt Not Appearing

## Root Cause

When the Python activity resumes after an HITL approval, the `StatusBuilder` is initialized with the DB-persisted status from the **previous** invocation (`[execute_graphton.py:1472](backend/services/agent-runner/worker/activities/execute_graphton.py)`):

```python
status_builder = StatusBuilder(execution_id, execution.status, approval_config)
```

This loaded status contains the first write's tool call with `TOOL_CALL_WAITING_APPROVAL` status -- it was never updated because the first invocation ended at the interrupt, before the tool could execute.

The resume setup code (lines 1824-1875) builds the LangGraph `Command(resume=...)` but **does not update the loaded tool call status** to reflect the approval decision. The stale `WAITING_APPROVAL` entry then poisons the interrupt matching:

### The cascade of failure

```
1. StatusBuilder initialized with DB status
   - tool_calls: [{id: OLD_RUN_ID, name: "write_file", status: WAITING_APPROVAL}]
   - pending_approvals: [{tool_call_id: OLD_RUN_ID, ...}]
   - tool_call_fingerprints: {} (empty - fresh StatusBuilder)

2. Stream starts (resume). First write re-executes:
   - on_tool_start: new run_id (NEW_RUN_ID_1), fingerprint not in {} -> creates SECOND entry
   - on_tool_end: updates NEW_RUN_ID_1 to COMPLETED (old entry untouched)

3. Second write starts:
   - on_tool_start: NEW_RUN_ID_2, creates entry with WAITING_APPROVAL
   - interrupt() -> stream ends

4. Post-stream interrupt capture (execute_graphton.py:2402-2479):
   - 1 interrupt for the second write (tool_name="write")
   - Iterates tool_calls looking for WAITING_APPROVAL:
     -> OLD entry: name="write_file", status=WAITING_APPROVAL -> MATCH (first hit!)
     -> NEW second write: never reached
   - PendingApproval.tool_call_id = OLD_RUN_ID

5. CLI receives status update:
   - pending_approvals[0].tool_call_id = OLD_RUN_ID
   - promptedIDs[OLD_RUN_ID] == true (already prompted in first cycle)
   - SKIPPED! No approval prompt shown.
```

The CLI's `promptedIDs` guard (`run_stream_events.go:105`) correctly prevents re-prompting for the same tool call ID. The bug is that the **wrong** tool call ID is in the `PendingApproval`.

## Fix

Add a **resume state reconciliation step** in `[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` that runs after building the resume command and before starting the stream. This step:

### Change 1: Reconcile approved tool calls (execute_graphton.py)

After the `resume_dict` is built (around line 1875) and before the phase is set to `IN_PROGRESS` (line 1883), add a reconciliation block:

For each `pending_approval` in the loaded status that has a matching approval decision:

- **APPROVE**: Update the tool call status from `WAITING_APPROVAL` to `TOOL_CALL_RUNNING` (it's about to execute)
- **SKIP**: Update to `TOOL_CALL_SKIPPED`
- **REJECT**: Update to `TOOL_CALL_FAILED`

Clear `current_status.pending_approvals` (they're no longer pending).

This ensures stale `WAITING_APPROVAL` entries don't interfere with new interrupt matching.

### Change 2: Pre-populate fingerprints (status_builder.py)

Add a method to `StatusBuilder` that populates `tool_call_fingerprints` from existing tool calls in the loaded status. Call it during resume setup.

This prevents duplicate tool call entries when LangGraph re-fires `on_tool_start` for resumed tools (cosmetic, but avoids confusing UI with duplicate entries).

### Change 3: Use `set_tool_waiting_approval` for consistency (status_builder.py)

The current code has two paths that set tool calls to WAITING_APPROVAL:

- `_handle_tool_start_event` -> `_populate_pending_approval` (during stream)
- `set_tool_waiting_approval` (legacy, currently unused by the event processing path)

`_populate_pending_approval` (line 1198-1236) does NOT save the phase correctly on the second call -- it unconditionally overwrites `_saved_phase_before_approval`:

```python
self._saved_phase_before_approval = self.current_status.phase
```

This should use the same guard as `set_tool_waiting_approval` (save only on FIRST pending approval). Minor, but worth fixing for correctness.

## Files Changed

- `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` -- Add resume state reconciliation after building resume command
- `[backend/services/agent-runner/worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)` -- Add `populate_fingerprints_from_status()` method; fix `_populate_pending_approval` phase-save guard

## Verification

After the fix, the flow becomes:

```
1. Resume setup: OLD tool call updated to RUNNING, pending_approvals cleared, fingerprints populated
2. Stream: first write on_tool_start deduplicated (fingerprint exists). Second write processed normally.
3. Interrupt capture: only NEW second write has WAITING_APPROVAL -> correct match
4. PendingApproval.tool_call_id = NEW_RUN_ID_2
5. CLI: promptedIDs[NEW_RUN_ID_2] == false -> prompt shown!
```

## Design Note

This fix is surgical and contained. It doesn't change the approval policy chain, the CLI event handling, the Temporal workflow loop, or the LangGraph interrupt/resume mechanism. It only reconciles the StatusBuilder's loaded state with the approval decisions before the stream begins -- bringing the in-memory state in sync with what actually happened.