---
name: Execute tool approval UX
overview: Improve the CLI UX for shell/execute tool approvals by rendering commands in a terminal-like style and eliminating redundant approval confirmation blocks.
todos:
  - id: shell-aware-prompt
    content: Add isShellTool helper and terminal-style rendering branch in renderApprovalPrompt (render_approval.go)
    status: completed
  - id: hide-confirmation
    content: Replace approval block hiding instead of renderApprovalConfirmation replacement (approval.go)
    status: completed
  - id: footer-label
    content: Map raw tool names to display labels in the approval footer hint (view.go)
    status: completed
  - id: non-tui-path
    content: Apply shell-aware formatting to buildApprovalContent in the non-TUI approval path (run_display_approval.go)
    status: completed
  - id: dedup-message
    content: Suppress redundant 'Execute command:' message that duplicates the command arg
    status: completed
  - id: tests
    content: Update existing tests in render_approval and approval packages; add shell-specific test cases
    status: completed
isProject: false
---

# Improve Execute/Shell Tool Approval UX

## Domain Analysis (Architect Role)

### The Critique

The current approval flow treats all tool types identically with a generic key-value dump. This creates three problems specific to shell/execute tools:

1. **Redundant content duplication**: The `message` field from the backend says "Execute command: python3 ..." and the formatted `argsPreview` repeats "Command: python3 ...". The user sees the same command twice.
2. **Generic "Tool: execute" label**: The raw tool name "execute" is shown as `Tool: execute` -- this is an internal implementation detail, not user-facing information. The tool block already shows `🖥  Execute: <command>` with the proper icon and label.
3. **Orphaned confirmation block**: After approval, `"✅ Approved: execute"` is rendered as a separate system block that persists in the viewport. This is redundant with the tool block's badge transition (pause -> hourglass -> checkmark) and creates visual noise. The approval prompt is a *transient interaction*, not a *permanent record* -- it should not leave a footprint in the output.

### The Fix

- The tool block entity (`newStatefulToolBlock`) is the single source of truth for tool lifecycle. Its badge communicates state transitions: `⏸ → ⏳ → ✓`.
- The approval prompt is a transient UI artifact that should disappear after the user decides.
- Shell commands deserve a category-specific approval presentation that feels like a terminal prompt, not a generic form.

---

## Changes

### 1. Shell-aware approval prompt rendering

**File:** `[client-apps/cli/pkg/executiontui/render_approval.go](client-apps/cli/pkg/executiontui/render_approval.go)`

Add a shell-specific branch in `renderApprovalPrompt` that detects shell/execute tool names and renders a terminal-style prompt:

```
⏸  APPROVAL REQUIRED

   $ python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path .
   Timeout: 120
```

Instead of the current generic output:

```
⏸  APPROVAL REQUIRED

   Execute command: python3 ...
   Tool: execute
   Command: python3 ...
   Timeout: 120
```

Key decisions:

- Extract an `isShellTool(toolName)` helper to detect shell tool names (`shell`, `bash`, `execute`, `execute_command`, `run_command`, `terminal`).
- For shell tools: suppress the `message` line when it starts with "Execute command:" (it's a backend template that duplicates the command arg), suppress the "Tool: ..." line, and render the command with a `$` prefix to evoke a terminal prompt.
- Show secondary args (timeout, working_directory) as dimmed key-value lines beneath the command.
- For non-shell tools: keep the existing rendering untouched.

### 2. Eliminate the separate approval confirmation block

**File:** `[client-apps/cli/pkg/executiontui/approval.go](client-apps/cli/pkg/executiontui/approval.go)`

Currently at line 84-88, the approval block is replaced with `renderApprovalConfirmation(action, toolName)` which produces `"✅ Approved: execute"`. This is redundant.

Change: Instead of replacing the block content, hide the block entirely by setting `hidden = true`. The `renderedBlockText` function in `[render_blocks.go](client-apps/cli/pkg/executiontui/render_blocks.go)` (line 333) already skips hidden blocks, so this will cleanly remove the approval prompt from the viewport. The tool block's badge transition (`⏸ → ⏳` for approve, `⏸ → ⏭` for skip, `⏸ → ✗` for reject) already communicates the outcome.

This applies to *all* tool types, not just shell tools -- the badge-based lifecycle is the canonical UX across the board.

### 3. Improve footer hint during shell tool approval

**File:** `[client-apps/cli/pkg/executiontui/view.go](client-apps/cli/pkg/executiontui/view.go)`

Currently at line 132: `[a] Approve (execute)` -- the raw tool name "execute" is not user-friendly.

Change: Map the tool name to a human-readable display label using the same mapping from `toolrender` (e.g., "execute" -> "Execute", "shell" -> "Shell", "read_file" -> "Read"). This ensures the footer says `[a] Approve (Execute)` instead of `[a] Approve (execute)`, consistent with the tool block header.

### 4. Matching improvements for non-TUI approval path

**File:** `[client-apps/cli/cmd/stigmer/root/run_display_approval.go](client-apps/cli/cmd/stigmer/root/run_display_approval.go)`

Apply the same shell-aware formatting to `buildApprovalContent` so the panel-based (non-TUI) approval display also uses terminal-style command rendering for shell tools.

### 5. Deduplicate "Execute command:" message in approval args

**File:** `[client-apps/cli/pkg/executiontui/render_approval.go](client-apps/cli/pkg/executiontui/render_approval.go)`

For shell tools, the backend `message` field often contains "Execute command: " which duplicates the command shown in `argsPreview`. Add a helper `isRedundantShellMessage(message, argsPreview)` that detects this pattern and suppresses the message when it's just echoing the command.

---

## Files Unchanged

- `**toolrender/render.go`** -- Already has the correct shell tool display config (`"execute"` -> `🖥  Execute`). No changes needed.
- `**approval/formatter.go`** -- Already formats shell args correctly with `Command:` as primary field. The improvement is in how the approval *prompt* uses this formatted output, not in the formatter itself.
- `**handle_events.go`** -- The event handling logic for `ApprovalNeededEvent` is correct. Changes are in the rendering layer, not the event dispatch.

---

## Visual Before/After

### Before (current)

```
  🖥  Execute: python3 ... ⏸                          <-- tool block
  ⏸  APPROVAL REQUIRED                                 <-- approval block
     Execute command: python3 ...
     Tool: execute
     Command: python3 ...
     Timeout: 120
  [a] Approve (execute)  [s] Skip  [r] Reject          <-- footer

  -- after approval --

  🖥  Execute: python3 ... (631 chars, 18 lines) ✓     <-- tool block
  ✅ Approved: execute                                  <-- approval confirmation block (noise)
```

### After (proposed)

```
  🖥  Execute: python3 ... ⏸                          <-- tool block
  ⏸  APPROVAL REQUIRED                                 <-- approval block (cleaner)
     $ python3 ...
     Timeout: 120
  [a] Approve (Execute)  [s] Skip  [r] Reject          <-- footer (better label)

  -- after approval --

  🖥  Execute: python3 ... (631 chars, 18 lines) ✓     <-- tool block (badge tells the story)
                                                        <-- approval block hidden, no noise
```

