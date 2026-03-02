---
name: Humanize platform paths in approvals
overview: Replace `$STIGMER_PLATFORM_DIR` environment variable references with the user-facing `.stigmer` virtual mount prefix in all approval display surfaces, so users never see platform-internal implementation details.
todos:
  - id: humanize-fn
    content: Add `humanize_platform_refs()` utility function to `platform_mount.py` with regex-based replacement of `$STIGMER_PLATFORM_DIR` and `${STIGMER_PLATFORM_DIR}` with `.stigmer`
    status: completed
  - id: status-builder
    content: Enhance `_create_args_preview()` in `status_builder.py` to apply `humanize_platform_refs` to string values in the tool args dict
    status: completed
  - id: pending-approval-msg
    content: Apply `humanize_platform_refs` to `PendingApproval.message` in `execute_graphton.py` where the PendingApproval is assembled
    status: completed
  - id: tests
    content: Add unit tests for `humanize_platform_refs`, updated `_create_args_preview` output, and humanized PendingApproval.message
    status: completed
isProject: false
---

# Humanize Platform Path References in Approval Display

## Problem

When an agent calls the `execute` tool with a command like:

```
python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path .
```

The user sees `$STIGMER_PLATFORM_DIR` verbatim in the approval prompt. This is a platform-internal environment variable that means nothing to the user and breaks the abstraction the platform already provides for other operations (`.stigmer/` virtual mount prefix for read/write).

## Root Cause

The leak occurs across three layers:

1. **Agent instructions** (`[seedpack/agents/skill-creator.yaml](seedpack/agents/skill-creator.yaml)` lines 30-32, 57-59, 81-83) and the generic skill prompt (`[skill_writer.py](backend/services/agent-runner/worker/activities/graphton/skill_writer.py)` lines 319-326) tell the LLM to construct commands with `$STIGMER_PLATFORM_DIR`
2. **Backend** (`[status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)` `_create_args_preview` at line 2134) sanitizes sensitive keys but passes through env var references in command strings unchanged
3. **CLI** (both `[run_display_approval.go](client-apps/cli/cmd/stigmer/root/run_display_approval.go)` and `[executiontui/render_approval.go](client-apps/cli/pkg/executiontui/render_approval.go)`) renders whatever the backend sends without further sanitization

## Approach: Backend Display Sanitization

The fix belongs in the backend because it is the canonical source of display data consumed by all clients (CLI, future web UI, etc.). The approach leverages the existing `.stigmer/` virtual mount prefix -- the same abstraction users already see for read/write paths.

**Before:**

```
$ python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path .
```

**After:**

```
$ python3 .stigmer/skills/skill-creator/scripts/init_skill.py agent-creator --path .
```

### Why `.stigmer/` is the right replacement

- Users already see `.stigmer/` in read/write tool displays (`read .stigmer/skills/skill-creator/SKILL.md`)
- It is the established user-facing abstraction defined in `[platform_mount.py](backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py)` (`PLATFORM_PREFIX = ".stigmer/"`)
- It communicates "this is a platform-managed file" without exposing how the platform manages it

### Why the env var must stay in the actual command

The `execute` tool runs commands in a shell subprocess. The shell expands `$STIGMER_PLATFORM_DIR` at runtime. The `.stigmer/` prefix does not resolve to a real filesystem path in the execution context. So the agent must continue using the env var in the actual command -- we are only changing what the user sees in the approval preview.

## Changes

### 1. Add `humanize_platform_refs()` to `platform_mount.py`

File: `[backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py](backend/libs/python/graphton/src/graphton/core/backends/platform_mount.py)`

Add a utility function that replaces all forms of the env var reference with the `.stigmer` prefix:

- `$STIGMER_PLATFORM_DIR/...` becomes `.stigmer/...`
- `${STIGMER_PLATFORM_DIR}/...` (brace syntax) becomes `.stigmer/...`
- Standalone `$STIGMER_PLATFORM_DIR` (no trailing path) becomes `.stigmer`

This function lives next to the constant it references (`STIGMER_PLATFORM_DIR_ENV`), keeping the platform path abstraction cohesive.

### 2. Apply in `_create_args_preview()` in `status_builder.py`

File: `[backend/services/agent-runner/worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)` (line 2134)

Enhance `_create_args_preview` to apply `humanize_platform_refs` to string values in the tool args dictionary. This covers the `command` field for execute tools and any other field that might contain the env var.

### 3. Apply to `PendingApproval.message` at assembly point

File: `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` (~line 2800)

Where `PendingApproval` is constructed, apply `humanize_platform_refs` to the `message` field. The message comes from the approval policy template `"Execute command: {{args.command}}"` (`[approval_policy.py](backend/services/agent-runner/worker/activities/graphton/approval_policy.py)` line 77) and contains the raw command string.

### 4. Tests

- `**platform_mount.py` tests**: Unit tests for `humanize_platform_refs` covering `$VAR/path`, `${VAR}/path`, standalone `$VAR`, and strings with no env var references
- `**status_builder.py` tests**: Verify `_create_args_preview` output replaces `$STIGMER_PLATFORM_DIR` with `.stigmer` in command values
- `**execute_graphton.py` tests**: Verify PendingApproval.message is humanized

## Scope Boundaries

- **In scope**: Display sanitization of `$STIGMER_PLATFORM_DIR` in approval previews and messages
- **Out of scope**: Changing the actual command sent to the shell (the env var must remain for execution), changing agent instructions (the LLM still needs to use `$STIGMER_PLATFORM_DIR` in commands), introducing new tools or modifying the execute tool's parameter schema
- **Future consideration**: If the resolved absolute path (e.g., `/tmp/stigmer-platform-abc/`) ever appears in display strings, the humanization function could be extended to accept the resolved value and replace that too. This is not needed now since the LLM uses the env var reference, not the resolved path.

