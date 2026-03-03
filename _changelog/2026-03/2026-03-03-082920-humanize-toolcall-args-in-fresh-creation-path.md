# Humanize ToolCall.args in Fresh Creation Path

**Date**: March 3, 2026

## Summary

Fixed an asymmetry where `ToolCall.args` in the status proto contained raw environment-variable references (`$STIGMER_PLATFORM_DIR`, `$OUTPUT_DIR`) when the tool call was created via the fresh-creation path in `_handle_tool_start_event`. The reconciliation path already humanized args correctly; this fix makes both paths consistent.

## Problem Statement

When an agent called the `execute` tool and the tool call went through the fresh-creation path (no early tool call to reconcile), the tool result header in the CLI displayed raw environment variables:

```
Execute: python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py mcp-server-creator --path $OUTPUT_DIR
```

Meanwhile, the approval prompt for the same tool call correctly showed humanized paths:

```
$ python3 .stigmer/skills/skill-creator/scripts/init_skill.py mcp-server-creator --path seedpack/skills
```

### Pain Points

- Users saw raw `$STIGMER_PLATFORM_DIR` and `$OUTPUT_DIR` in the tool result display, undermining the `.stigmer/` virtual-mount UX abstraction
- The approval prompt (via `PendingApproval.args_preview`) was correctly humanized, creating an inconsistent experience within the same tool call lifecycle
- The reconciliation path in `_reconcile_early_tool_call` already humanized args, but the fresh-creation path in `_handle_tool_start_event` did not

## Solution

Applied the same `_humanize_args_for_display` call used by `_reconcile_early_tool_call` to the fresh-creation path in `_handle_tool_start_event`. The raw `tool_args` dict remains available for downstream consumers (approval checking, fingerprinting, message template rendering).

## Implementation Details

### `status_builder.py` — Fresh creation path (line 640-642)

Replaced raw args serialization:

```python
args_struct = Struct()
if tool_args:
    args_struct.update(tool_args)
```

With humanized display args:

```python
display_args = self._humanize_args_for_display(tool_args) if tool_args else {}
args_struct = Struct()
if display_args:
    args_struct.update(display_args)
```

The `_humanize_args_for_display` method creates a shallow copy (original dict unmodified), applies `humanize_platform_refs` (`$STIGMER_PLATFORM_DIR` -> `.stigmer`), then `resolve_display_env_vars` (resolves non-secret env vars to their values).

### Test coverage

Added `TestToolCallArgsHumanization` with four tests exercising the fresh-creation path through `process_event`:

- Platform dir humanization in `ToolCall.args`
- Combined platform dir + agent env var resolution
- Secret env var protection (remains unexpanded)
- Pass-through for args without env vars

## Benefits

- Consistent user experience: tool result headers now show the same humanized paths as approval prompts
- All clients benefit (CLI, future web UI, mobile) since the fix is at the backend data layer
- No new abstractions — reuses the existing `_humanize_args_for_display` method

## Impact

- All tool calls created via the fresh-creation path now display humanized args
- Particularly visible for `execute` tool calls that reference `$STIGMER_PLATFORM_DIR` or agent `env_spec` variables
- Zero impact on tool execution — the shell still receives and expands the real environment variables

## Related Work

- `2026-03-02-034718` — Humanize platform paths in approval display (the `PendingApproval.args_preview` side)
- `2026-03-02-042525` — Inject `env_spec` variables into agent shell environment
- `2026-03-02-033559` — Added `env_spec` to `skill-creator.yaml`

---

**Status**: Production Ready
