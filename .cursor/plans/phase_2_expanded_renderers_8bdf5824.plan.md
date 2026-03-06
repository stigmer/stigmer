---
name: Phase 2 Expanded Renderers
overview: Add expanded rendering functions to the toolrender package and wire them into the re-commit infrastructure, so the existing clear+re-commit mechanism from Phase 1 can replay history in expanded mode. Phase 3 (Ctrl+O toggle) will use this to let users switch at runtime.
todos:
  - id: expanded-renderers
    content: Create render_expanded.go with RenderExpanded and RenderReadGroupExpanded in toolrender package
    status: completed
  - id: wire-expanded
    content: Thread expanded bool through renderCommittedItem, reCommitHistory, reCommitMsg, and handleReCommit
    status: completed
  - id: expanded-tests
    content: Write render_expanded_test.go and update history tests for expanded parameter
    status: completed
  - id: build-verify
    content: Update BUILD.bazel files and verify go vet + all tests pass
    status: completed
isProject: false
---

# Phase 2: Expanded Renderers + Re-Commit Wiring

## Scope

This phase adds the **rendering layer only**. No state toggle, no keybinding -- those are Phase 3. The deliverable is: every `committedKind` that stores structured data can re-render in either compact or expanded mode, controlled by a boolean parameter threaded through `renderCommittedItem` and `reCommitHistory`. Fully testable via unit tests without any UI interaction.

## What "Expanded" Means Per Tool Type

### Tools that change


| Tool            | Compact (today)                                                     | Expanded                                                                                |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Read group**  | Header + up to 3 entries + `... +N more`                            | Header + ALL entries (same format: hyperlinked path + line count). **No file content.** |
| **Shell**       | Truncated command (60 chars) + 3 output lines + `... +N more lines` | Full first-line command + ALL output lines                                              |
| **Think**       | 3 thought lines + `... +N more lines`                               | ALL thought lines                                                                       |
| **Discovery**   | Header + count summary (`Found 12 matches`)                         | Header + ALL result entries (one per line)                                              |
| **Unknown/MCP** | Input args + 3 result lines + `... +N more lines`                   | Input args + ALL result lines                                                           |


### Tools that stay identical


| Tool                  | Why unchanged                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| **Read (individual)** | Already shows path (hyperlinked) + line count. User can click to open file. No content in either mode. |
| **Write/Edit/Create** | Path + line count is sufficient. Full content visible during approval flow.                            |
| **Delete**            | Already complete: path + "Deleted".                                                                    |
| **Approval result**   | Post-decision view is already informative. Preview stays at its current 10-line cap.                   |


### Design rationale for reads (aligned with user direction)

Expanded read groups simply lift the `maxVisibleInGroup` (3) cap. Each entry already has a hyperlinked path via `buildHyperlinkedPath` -- clicking opens the file in the terminal's configured handler. Showing file content would clutter the view. This keeps expanded mode a quick, scannable list of everything the agent read.

## Implementation

### Step 1: New file `render_expanded.go` in toolrender package

Two public functions that mirror the compact API:

`**RenderExpanded(tc ToolCallInfo, opts CompactOptions) string`**

- Routes by tool type via `toolDisplayMap`, same as `RenderCompact`
- Read, Write/Edit, Delete: delegate directly to their compact renderers (identical output)
- Shell: `renderExpandedShell` -- reuses header from `renderCompactShell` pattern, shows ALL output lines (no `maxShellOutputLines` cap)
- Think: `renderExpandedThink` -- same pattern, no `maxThinkLines` cap
- Discovery: `renderExpandedDiscovery` -- header + individual result entries instead of count summary
- Unknown: `renderExpandedUnknown` -- same header + input args, ALL result lines (no `maxUnknownOutputLines` cap)

`**RenderReadGroupExpanded(reads []ToolCallInfo, opts CompactOptions) string`**

- Same header format: `bullet Read N files [(M failed)]`
- ALL entries via `renderGroupEntry` (no `maxVisibleInGroup` limit, no `... +N more` footer)

Internal helpers (`renderExpandedShell`, `renderExpandedThink`, `renderExpandedDiscovery`, `renderExpandedUnknown`) are package-private. They share header-building and error-handling logic with compact renderers via existing helpers (`extractPrimaryArgWithFallbacks`, `buildHyperlinkedPath`, `toolCallError`, `resolveDisplayContent`, etc.).

Key code pattern (shell example):

```go
func renderExpandedShell(tc ToolCallInfo, info toolDisplayInfo, opts CompactOptions) string {
    command := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
    displayCmd := truncate(firstLine(command), 60)
    header := fmt.Sprintf("%s %s(%s)", bulletStyle.Render("●"), labelStyle.Render(info.label), displayCmd)
    
    if tc.Status == "failed" || tc.Error != "" {
        // same error handling as compact
    }
    
    content := resolveDisplayContent(tc, info)
    // ... no truncation, show all lines
}
```

### Step 2: Wire expanded mode through re-commit path

`**run_stream_inline_history.go**` -- 3 signature changes:

```go
func renderCommittedItem(item committedItem, opts CompactOptions, expanded bool) string
func renderToolCompactItem(item committedItem, opts CompactOptions, expanded bool) string
func renderReadGroupItem(item committedItem, opts CompactOptions, expanded bool) string
func reCommitHistory(items []committedItem, opts CompactOptions, expanded bool) tea.Cmd
```

- `renderToolCompactItem`: when `expanded`, calls `toolrender.RenderExpanded` instead of `toolrender.RenderCompact`
- `renderReadGroupItem`: when `expanded`, calls `toolrender.RenderReadGroupExpanded` instead of `toolrender.RenderReadGroup` (for groups >= threshold); for below-threshold groups, calls `RenderExpanded` per item
- `renderApprovalItem`: unchanged (same in both modes)
- `reCommitHistory`: passes `expanded` to `renderCommittedItem`

`**run_stream_inline_messages.go**`:

```go
type reCommitMsg struct {
    items       []committedItem
    compactOpts toolrender.CompactOptions
    expanded    bool
}
```

`**run_stream_inline_bubbletea.go**`:

```go
func (m inlineBubbleModel) handleReCommit(msg reCommitMsg) (tea.Model, tea.Cmd) {
    return m, reCommitHistory(msg.items, msg.compactOpts, msg.expanded)
}
```

`**triggerReCommit` in history.go**: passes `expanded: false` for now (Phase 1 subject update is always compact). Phase 3 will thread the actual expand state.

### Step 3: Tests

**New file: `render_expanded_test.go`** (in `client-apps/cli/pkg/toolrender/`):

- Shell expanded: verify ALL output lines present, no `... +N more lines` footer
- Shell expanded with error: same as compact (error short-circuits)
- Shell expanded empty output: same as compact (`(no output)`)
- Think expanded: verify ALL thought lines, no truncation footer
- Discovery expanded: verify individual result entries shown (not just count)
- Unknown/MCP expanded: verify ALL result lines, no truncation footer
- Read expanded: verify identical to compact (delegates)
- Write expanded: verify identical to compact (delegates)
- Delete expanded: verify identical to compact (delegates)
- Read group expanded: verify ALL entries shown, no `... +N more` footer
- Read group expanded with failures: verify error entries present
- Read group expanded with subAgent: verify gutter wrapping

**Update: `run_stream_inline_history_test.go`**:

- Update existing `renderCommittedItem` tests to pass `expanded: false` (preserving current behavior)
- Add expanded variants for `kindToolCompact` (shell), `kindReadGroup` (5+ reads), verifying expanded output

### Step 4: BUILD.bazel update

Add `render_expanded.go` and `render_expanded_test.go` to the `toolrender` BUILD target.

## Files Inventory

### New (2)

- `[client-apps/cli/pkg/toolrender/render_expanded.go](client-apps/cli/pkg/toolrender/render_expanded.go)` -- `RenderExpanded`, `RenderReadGroupExpanded`, internal expanded renderers
- `[client-apps/cli/pkg/toolrender/render_expanded_test.go](client-apps/cli/pkg/toolrender/render_expanded_test.go)` -- tests for all expanded renderers

### Modified (4)

- `[client-apps/cli/cmd/stigmer/root/run_stream_inline_history.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_history.go)` -- `expanded bool` parameter threading
- `[client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_messages.go)` -- `expanded` field on `reCommitMsg`
- `[client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_bubbletea.go)` -- pass `expanded` through `handleReCommit`
- `[client-apps/cli/cmd/stigmer/root/run_stream_inline_history_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_history_test.go)` -- update existing tests + add expanded variants

### BUILD files (2)

- `client-apps/cli/pkg/toolrender/BUILD.bazel` -- add new source + test files
- `client-apps/cli/cmd/stigmer/root/BUILD.bazel` -- no change expected (test file already tracked)

## Design Decision: `CompactOptions` naming

`CompactOptions` is used by both compact and expanded renderers. The name is misleading now that it carries general rendering config (hyperlinks, workspace roots, stat function). Consider renaming to `RenderOptions` in a future cleanup pass. Not blocking for Phase 2 -- the struct contents are correct, only the name is inaccurate.

## Verification Plan

1. `go vet ./client-apps/cli/...` -- clean
2. All new tests pass: `go test ./client-apps/cli/pkg/toolrender/ -run Expanded`
3. All existing tests pass: `go test ./client-apps/cli/cmd/stigmer/root/ -run TestRenderCommittedItem`
4. No behavioral change in compact mode (expanded=false produces identical output to current code)

