# Humanize Platform Paths in Approval Display

**Date**: March 2, 2026

## Summary

Replaced raw `$STIGMER_PLATFORM_DIR` environment variable references with the user-facing `.stigmer` virtual-mount prefix in approval prompts and messages. Users now see clean, consistent paths instead of internal platform implementation details.

## Problem Statement

When an agent called the `execute` tool with a platform-relative command, the approval prompt displayed the raw environment variable:

```
$ python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path .
```

`$STIGMER_PLATFORM_DIR` is a sandbox-internal mechanism that means nothing to the end user.

### Pain Points

- The platform already has a clean `.stigmer/` virtual mount abstraction for `read` and `write` operations, but `execute` broke this abstraction by exposing the raw env var
- Users had no context for what `$STIGMER_PLATFORM_DIR` meant or where it pointed
- The inconsistency between `.stigmer/` for reads and `$STIGMER_PLATFORM_DIR` for executes undermined the platform's UX coherence

## Solution

Backend display sanitization: replace `$STIGMER_PLATFORM_DIR` (and `${STIGMER_PLATFORM_DIR}`) with `.stigmer` in all approval display surfaces. The actual command sent to the shell is unchanged — only the preview shown to the user is humanized.

**After:**
```
$ python3 .stigmer/skills/skill-creator/scripts/init_skill.py agent-creator --path .
```

## Implementation Details

### New utility: `humanize_platform_refs()`

Added to `platform_mount.py` alongside the existing `STIGMER_PLATFORM_DIR_ENV` constant, keeping the path abstraction cohesive. Uses a compiled regex with:
- Brace form `${STIGMER_PLATFORM_DIR}` matched first to avoid stray braces
- Negative lookahead `(?![A-Za-z0-9_])` on the bare-dollar form to prevent false matches on longer variable names (e.g., `$STIGMER_PLATFORM_DIR_OTHER`)

### Applied at two backend chokepoints

1. **`_create_args_preview()`** in `status_builder.py` — all string values in tool argument previews are humanized before JSON serialization. This covers the `command` field for execute tools and nested dict values.

2. **`PendingApproval.message`** in `execute_graphton.py` — the approval message (e.g., "Execute command: python3 $STIGMER_PLATFORM_DIR/...") is humanized when the `PendingApproval` proto is assembled.

Both apply at the backend level so all clients (CLI, future web UI) benefit.

## Benefits

- Consistent user-facing path abstraction: `.stigmer/` everywhere
- No leaked internal implementation details in approval prompts
- Zero change to actual command execution — the shell still expands the real env var

## Impact

- All agent executions that reference platform files (`execute` tool calls with `$STIGMER_PLATFORM_DIR`) now display clean paths in approval prompts
- Both CLI rendering paths (legacy panel and TUI) benefit automatically since the sanitization happens at the backend data layer

## Related Work

- 2026-03-02: Improve execute tool approval UX (terminal-style rendering)
- 2026-03-02: Fix skill-creator output path (hardcoded to workspace root)
- Platform mount design: AD-01 v3 (virtual `.stigmer/` namespace)

---

**Status**: Production Ready
