---
name: Fix ToolCall args humanization
overview: Humanize `ToolCall.args` in the fresh-creation path of `_handle_tool_start_event` to match the existing reconciliation path, eliminating raw `$STIGMER_PLATFORM_DIR` and `$OUTPUT_DIR` references from the tool result display.
todos:
  - id: fix-fresh-creation-path
    content: Humanize ToolCall.args in the fresh-creation path of _handle_tool_start_event (line 640-642 in status_builder.py)
    status: completed
  - id: add-test-coverage
    content: Add test in test_status_builder.py verifying _handle_tool_start_event produces humanized args in the ToolCall proto
    status: completed
  - id: verify-stigmer-cloud-sync
    content: Verify whether stigmer-cloud has the same file and note that same fix is needed there
    status: completed
isProject: false
---

# Fix ToolCall Args Humanization Gap

## Root Cause

In `[status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`, `_handle_tool_start_event` has two code paths for creating/updating `ToolCall` entries:

- **Reconciliation path** (line 1595-1599): Already humanizes args correctly:

```1595:1599:backend/services/agent-runner/worker/activities/graphton/status_builder.py
            if tool_args:
                display_args = self._humanize_args_for_display(tool_args)
                args_struct = Struct()
                args_struct.update(display_args)
                existing.args.CopyFrom(args_struct)
```

- **Fresh creation path** (line 640-642): Stores raw args with unexpanded env vars:

```640:642:backend/services/agent-runner/worker/activities/graphton/status_builder.py
        args_struct = Struct()
        if tool_args:
            args_struct.update(tool_args)
```

The fresh creation path is reached when no early tool call exists to reconcile (e.g., different model streaming behavior, race conditions, or tools whose `on_tool_start` fires before the stream emits a `tool_use` block).

## Fix

Apply the same humanization pattern used by `_reconcile_early_tool_call` to the fresh creation path. The `_humanize_args_for_display` method already:

- Creates a shallow copy (original `tool_args` dict is never modified -- safe for downstream fingerprinting, approval checks, and template rendering)
- Applies `humanize_platform_refs`: `$STIGMER_PLATFORM_DIR` -> `.stigmer`
- Applies `resolve_display_env_vars`: `$OUTPUT_DIR` -> its resolved value, respecting `_secret_keys`
- Gracefully handles `None` env vars (just applies platform path humanization)

### Change in `status_builder.py` (line 640-642)

Replace:

```python
args_struct = Struct()
if tool_args:
    args_struct.update(tool_args)
```

With:

```python
display_args = self._humanize_args_for_display(tool_args) if tool_args else {}
args_struct = Struct()
if display_args:
    args_struct.update(display_args)
```

This is a 3-line change. The rest of `_handle_tool_start_event` continues to use the raw `tool_args` dict for approval checking (line 636), fingerprinting, and message template rendering -- all unaffected.

### Test in `test_status_builder.py`

Add a test that verifies `_handle_tool_start_event` produces humanized args in the resulting `ToolCall.args` proto. This covers the fresh-creation path specifically (not the reconciliation path, which is already correct).

## Design Rationale

- **Backend-level fix**: All clients (CLI, future web UI, mobile) benefit. Follows the established pattern where the backend is the single place responsible for display sanitization (per the `humanize-platform-paths-in-approval-display` changelog).
- **No proto change needed**: `ToolCall.args` is purely a display/audit field in the status proto. The actual tool execution uses the raw `tool_args` dict from LangGraph, which is completely independent.
- **Consistent with reconciliation path**: The exact same method and pattern is used -- no new abstractions.

