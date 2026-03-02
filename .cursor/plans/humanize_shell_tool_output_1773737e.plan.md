---
name: Humanize Shell Tool Output
overview: "Redesign the execute/shell tool result formatting to feel like a natural terminal experience: suppress \"Exit code: 0\" and \"STDOUT:\"/\"STDERR:\" labels on success, show only the command output, and surface failure details clearly when commands fail. Changes span the backend result formatter and CLI result renderer."
todos:
  - id: backend-format
    content: "Rewrite execute tool result formatting in tool_wrappers.py: clean output on success, structured error on failure"
    status: completed
  - id: cli-clean-fn
    content: Add CleanShellResult() function in toolrender/format.go for backward-compat stripping of old-format labels
    status: completed
  - id: cli-wire
    content: Wire CleanShellResult into resolveDisplayContent for shell tools in render_known.go
    status: completed
  - id: backend-tests
    content: Add/update backend unit tests for execute tool result formatting
    status: completed
  - id: cli-tests
    content: Add CLI unit tests for CleanShellResult and shell tool rendering with old/new formats
    status: completed
isProject: false
---

# Humanize Shell Tool Output

## Problem

When a shell/execute tool completes, the user sees raw internal formatting:

```
Exit code: 0
STDOUT:
file1
file2
```

This is verbose, technical, and un-terminal-like. A human running a command in a terminal sees only the output. The `STDOUT:`/`STDERR:` labels and `Exit code: 0` add no value on success and clutter every single command execution.

## Root Cause

The formatting lives in **one place** in the backend:

`[tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py)` lines 1085-1098:

```python
output_parts = []
if result.stdout:
    output_parts.append(f"STDOUT:\n{result.stdout}")
if result.stderr:
    output_parts.append(f"STDERR:\n{result.stderr}")
output = "\n".join(output_parts) if output_parts else "(no output)"
return f"Exit code: {result.exit_code}\n{output}"
```

This string flows unchanged through the proto `ToolCall.result` field all the way to the CLI, which renders it verbatim via `formatFileContentPreview` / `formatFullResultWithGutter`.

## Design Decision: Where to Fix

**Backend-first approach** (recommended, with CLI defense-in-depth):

- The backend is the single source of this formatting. Fixing it there means every client (CLI, future web UI, API consumers) benefits immediately.
- The CLI adds a thin parsing layer as defense-in-depth so that older backend versions or edge cases still render cleanly.

## Changes

### 1. Backend: Clean up execute tool result format (`tool_wrappers.py`)

**File:** `[backend/libs/python/graphton/src/graphton/core/tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py)`

**Success case (exit code 0):**

- Return only the combined stdout+stderr output, no labels, no exit code
- If both stdout and stderr exist, concatenate with a blank line separator (stderr after stdout) -- this mirrors how terminals interleave output
- If neither exists, return `"(no output)"`

**Failure case (exit code != 0):**

- Prepend a clear failure header: `"Command failed (exit code N)"`
- Show stderr first (the error), then stdout if any -- stderr is what the user needs to see for failures
- If stderr is empty but stdout has content, show stdout

Example success output:

```
file1
file2
```

Example failure output:

```
Command failed (exit code 1)
Permission denied: /etc/shadow
```

### 2. CLI: Shell-specific result cleaning in `toolrender` (`format.go`)

**File:** `[client-apps/cli/pkg/toolrender/format.go](client-apps/cli/pkg/toolrender/format.go)`

Add a `CleanShellResult(result string) string` function that:

- Strips a leading `"Exit code: 0\n"` prefix if present (backward compat with old backends)
- Strips `"STDOUT:\n"` and `"STDERR:\n"` labels if present
- Returns the cleaned output

### 3. CLI: Wire shell-specific cleaning into display (`render_known.go`)

**File:** `[client-apps/cli/pkg/toolrender/render_known.go](client-apps/cli/pkg/toolrender/render_known.go)`

In `resolveDisplayContent`, when the tool is a shell tool (detected via `info.primaryField == "command"`), apply `CleanShellResult()` to the resolved content before returning. This ensures both collapsed preview and expanded view show clean output.

### 4. Tests

- **Backend:** Update/add unit tests in the graphton test suite for `_create_execute_tool` covering success (no exit code shown), failure (exit code shown), mixed stdout+stderr, and no-output cases.
- **CLI:** Add test cases in `[render_test.go](client-apps/cli/pkg/toolrender/render_test.go)` for `CleanShellResult` and for shell tool rendering with both old-format and new-format results.

## What This Does NOT Change

- The approval prompt UX (already fixed per the changelog)
- The proto schema (`ToolCall.result` remains a string)
- Non-shell tool rendering (no impact)
- The LLM's view of tool results (the LLM still receives the full result string for reasoning -- this only changes the human-facing display)

**Wait** -- actually, this changes what the LLM receives too, since `tool_wrappers.py` returns the string that becomes the `ToolMessage.content`. This is actually desirable: the LLM doesn't need `STDOUT:` labels either. But we should keep the failure exit code in the LLM-facing string so it can reason about errors.

## Environment Variables (Separate Concern)

The user mentioned env vars not getting resolved. The investigation shows:

- At execution time, env vars ARE injected into the subprocess (`filesystem.py` merges them into `env`)
- For display (approval prompts), `resolve_display_env_vars()` handles expansion
- The "not resolved" issue likely refers to env vars appearing in the **command text** shown in the approval preview or tool header (e.g., `$STIGMER_PLATFORM_DIR/scripts/init_skill.py`)

This is a separate issue tracked by the existing plan at `[.cursor/plans/inject_env_spec_into_shell_8734fc8b.plan.md](.cursor/plans/inject_env_spec_into_shell_8734fc8b.plan.md)`. The current plan focuses solely on the post-execution result display.