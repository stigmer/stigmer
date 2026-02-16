# Fix: Artifacts Not Downloaded After Approval Resume

**Date**: February 16, 2026

## Summary

Fixed a critical bug in the HITL (Human-in-the-Loop) approval flow where files created by agents were not being published as downloadable artifacts after the approval and resume cycle. The root cause was a run-ID mismatch that prevented tool calls from ever reaching `COMPLETED` status, which in turn blocked the auto-publish safety net from detecting modified files.

## Problem Statement

When executing `stigmer draft skill` with approval policies enabled, the agent would successfully write files to the sandbox after receiving user approval, the execution would complete without errors, and logs would show successful file writes. However, the CLI would report "No skill artifacts were generated" and no files would be downloaded to the specified output directory.

### Pain Points

- Files were being written to the sandbox but never published as artifacts
- The auto-publish safety net (`_auto_publish_written_files`) was finding zero completed write tool calls
- Tool calls that went through the approval flow remained stuck at `RUNNING` status permanently
- No diagnostic information to understand why the auto-publish mechanism was skipping the writes
- The issue was invisible in the execution logs because write tool calls showed "approval granted" but never transitioned to "completed"

## Solution

Implemented a run-ID alias mapping mechanism in `StatusBuilder` that bridges the gap between the original run_id assigned to a tool call and the new run_id that LangGraph generates when the tool execution resumes after approval.

### How It Works

1. **Fingerprint-to-ID Mapping**: When `populate_fingerprints_from_existing_tool_calls()` pre-populates the deduplication fingerprint set on the resume path, it now also builds a `_fingerprint_to_tool_call_id` map that records which existing tool call each fingerprint belongs to.

2. **Alias Recording**: When `_handle_tool_start_event()` detects a duplicate fingerprint (indicating the tool is being resumed with a new run_id), it looks up the original tool call via the fingerprint map and records an alias: `_run_id_aliases[new_run_id] = original_tool_call_id`.

3. **Alias Resolution**: `_handle_tool_end_event()` and `_handle_tool_progress_event()` now call `_resolve_run_id()` to resolve aliases before searching for the tool call to update. This enables them to find the correct tool call using the original ID and transition it to `COMPLETED` status.

## Implementation Details

### Files Modified

**1. `backend/services/agent-runner/worker/activities/graphton/status_builder.py`**

- Added `_run_id_aliases: dict[str, str]` to `__init__` — maps new run_ids to original tool call IDs
- Added `_fingerprint_to_tool_call_id: dict[str, str]` to `__init__` — maps fingerprints to tool call IDs
- Updated `populate_fingerprints_from_existing_tool_calls()` to populate the fingerprint-to-ID map
- Updated `_handle_tool_start_event()` to record run-ID aliases when fingerprint deduplication fires
- Added `_resolve_run_id()` helper method for alias resolution
- Updated `_handle_tool_end_event()` to use alias resolution before matching tool calls
- Updated `_handle_tool_progress_event()` to use alias resolution for consistency
- Added diagnostic logging in `_handle_tool_start_event()` when aliases are recorded

**2. `backend/services/agent-runner/worker/activities/execute_graphton.py`**

- Enhanced `_auto_publish_written_files()` with comprehensive diagnostic logging that enumerates every file-modifying tool call with its name, status, path, and ID
- Changed the "no completed writes" log level from DEBUG to INFO for better visibility

**3. `backend/services/agent-runner/tests/test_status_builder.py`**

- Added new `TestRunIdAliasResolution` test class with 7 comprehensive tests:
  - `test_alias_recorded_on_duplicate_fingerprint` — Verifies alias is recorded on resume
  - `test_tool_end_resolves_alias_to_completed` — End-to-end test of the fix (start → dedup → end → COMPLETED)
  - `test_multiple_writes_all_transition_to_completed` — Tests multiple file writes in sequence
  - `test_resolve_run_id_returns_original_when_no_alias` — Tests helper with no alias
  - `test_resolve_run_id_returns_alias_when_present` — Tests helper with alias
  - `test_tool_progress_resolves_alias` — Verifies streaming progress works with aliases
  - `test_no_alias_when_run_id_matches_existing` — Edge case where run_ids happen to match

### The Mismatch Sequence (Before Fix)

```
Invocation 1 (original):
  on_tool_start(write, run_id=A) → Create ToolCall(id=A, WAITING_APPROVAL)
  interrupt() → graph pauses

Invocation 2 (resume after approval):
  Reconcile: ToolCall(id=A) WAITING_APPROVAL → RUNNING
  Pre-populate fingerprint
  on_tool_start(write, run_id=B) → Fingerprint match → DEDUPLICATED (run_id=B lost)
  on_tool_end(run_id=B) → Search for id=B → NOT FOUND
  ToolCall stays RUNNING forever ❌

Post-stream:
  auto_publish checks for COMPLETED writes → None found (all RUNNING) → 0 artifacts
```

### The Fixed Sequence (After Fix)

```
Invocation 2 (resume after approval):
  Reconcile: ToolCall(id=A) WAITING_APPROVAL → RUNNING
  Pre-populate fingerprint AND fingerprint-to-ID map
  on_tool_start(write, run_id=B) → Fingerprint match → Record alias: B → A
  on_tool_end(run_id=B) → Resolve alias: B → A → Search for id=A → FOUND
  ToolCall transitions to COMPLETED ✅

Post-stream:
  auto_publish checks for COMPLETED writes → Found! → Publishes artifacts
```

## Benefits

1. **Files Are Downloaded**: The `stigmer draft skill` command now correctly downloads generated files to the output directory after approval cycles.

2. **Improved Observability**: The new diagnostic logging in `_auto_publish_written_files()` makes it trivially easy to diagnose "where did my files go?" issues by showing exactly which file-modifying tool calls were found and why they were included or skipped.

3. **Consistent Behavior**: Tool calls now transition through all expected states (`RUNNING` → `COMPLETED`) regardless of whether they went through the approval flow, making the execution status reliable for all downstream consumers.

4. **Non-Breaking**: The fix is surgical and localized to `StatusBuilder` — no changes to the auto-publish logic, CLI download logic, approval policy, or any other components. All existing tests continue to pass.

5. **Well-Tested**: 7 new tests provide comprehensive coverage of the resume-path scenario, including edge cases like multiple writes and streaming progress.

## Impact

### User-Facing

- **`stigmer draft skill`** now works correctly with approval policies enabled
- Generated skills, agents, and other artifacts are reliably downloaded to the specified output directory
- Users no longer see misleading "No skill artifacts were generated" warnings for successful executions

### Developer-Facing

- The run-ID alias mechanism is a reusable pattern for any future cases where LangGraph event IDs change across invocations
- Diagnostic logging in the auto-publish path significantly reduces debugging time for artifact-related issues
- The StatusBuilder's tool call lifecycle is now correctly modeled for resume scenarios

### Technical

- Fixes a fundamental state management bug in the agent execution framework
- Enables the entire HITL approval flow to work end-to-end with file-modifying tools
- The auto-publish safety net can now correctly detect and publish files created after approvals

## Related Work

- **Fix: HITL Write Tool Alias Approval** (2026-02-16-155311) — Added `write_file` and `edit_file` as approval-triggering aliases
- **Fix: HITL Approval Stream Race Condition** (2026-02-16-165045) — Fixed stream continuation logic for approval interrupts
- This fix completes the HITL approval flow by ensuring files are actually published after being written

---

**Status**: ✅ Production Ready  
**Timeline**: Identified and fixed in ~2 hours (investigation + implementation + testing)
