# CLI Tool Content Display and Approval Navigation Enhancement

**Date**: February 17, 2026

## Summary

Restored the 3-line content preview on collapsed tool blocks in the CLI, fixed Write tools to display input content instead of result confirmations, and enabled full navigation (expand/collapse, scroll) during approval prompts. These changes dramatically improve the user experience during HITL (human-in-the-loop) approval flows by allowing users to inspect tool content before making approval decisions.

## Problem Statement

The CLI's tool rendering had three critical usability issues that severely impacted the approval workflow:

### Pain Points

1. **Missing previews on collapsed tool blocks**: When stateful tool blocks were introduced, the 3-line content preview was lost. Users saw only header lines like `📝 Write: SKILL.md (11.0 KB, 384 lines) ⏸` with no preview of what was about to be written. This was especially problematic during approval prompts.

2. **Write tools showed confirmation instead of content**: Write tools displayed `tc.Result` ("Successfully wrote 11298 characters...") instead of the actual file content from `tc.Args["contents"]`. This made both preview and expanded views show useless confirmation messages rather than the content being written.

3. **Navigation blocked during approval**: When approval prompts were active, ALL keyboard input (Tab, Shift+Tab, Enter, arrow keys, g/G) was blocked except for a/s/r approval keys. Users couldn't expand tool blocks to inspect full content before deciding whether to approve.

4. **Shell tools had no preview**: Shell tools used `previewNone`, showing only the command in the header with no preview of command output after completion.

5. **Unknown/MCP tools had no preview**: Custom and MCP tools showed only headers with no content preview at all.

## Solution

Introduced a comprehensive content-source framework that explicitly declares whether each tool type displays input (args) or output (result) content, restored preview rendering to all code paths, and enabled full navigation during approval states.

### Key Design Decisions

1. **`contentSource` enum**: Added explicit content-source control (`contentSourceResult` vs `contentSourceInput`) to `toolDisplayInfo` rather than relying on implicit fallback ordering. Write/edit tools get `contentSourceInput`, ensuring they always show args content even when `tc.Result` is populated.

2. **Shared preview rendering**: Extracted `renderPreviewLines()` as a reusable building block called by both `Render()` (collapsed without badge) and `RenderWithBadge()` (collapsed with badge), eliminating code duplication.

3. **Preview for all tools**: Extended preview support to shell tools (`previewFileContent` on command output) and unknown/MCP tools (via `renderUnknownPreview()`).

4. **Navigation delegation during approval**: Refactored `handleApprovalKey()` to handle only approval decisions (a/s/r), delegating all other keys to `handleNavigationKey()` — a shared handler extracted from `handleKeyPress()` that processes Tab/Shift+Tab/Enter/g/G/scroll.

## Implementation Details

### File Changes

**`client-apps/cli/pkg/toolrender/render.go` (124 lines changed)**:
- Added `contentSource` enum type with `contentSourceResult` (zero value) and `contentSourceInput`
- Added `contentSource` field to `toolDisplayInfo` struct
- Configured write/edit tools with `contentSource: contentSourceInput`
- Changed shell tools from `previewNone` to `preview: previewFileContent`
- Updated `RenderWithBadge()` to include preview lines after header+badge:
  ```go
  if preview := renderPreviewLines(tc, info); preview != "" {
      header += "\n" + preview
  }
  ```
- Updated `RenderExpandedWithBadge()` and `RenderExpanded()` to use `renderUnknownHeader` for consistency

**`client-apps/cli/pkg/toolrender/render_known.go` (131 lines changed)**:
- Updated `resolveDisplayContent()` to respect `contentSource`:
  ```go
  if info.contentSource == contentSourceInput && info.contentArgField != "" {
      content := extractPrimaryArgWithFallbacks(tc.Args, info.contentArgField, ...)
      if content != "" {
          return content  // Prefer args for write/edit tools
      }
  }
  ```
- Extracted `renderPreviewLines()` from `renderKnown()` as a reusable function
- Refactored `renderUnknown()` into three functions:
  - `renderUnknownHeader()` — header only
  - `renderUnknownPreview()` — 3-line result preview
  - `renderUnknown()` — header + preview

**`client-apps/cli/pkg/executiontui/update.go` (25 lines changed)**:
- Extracted `handleNavigationKey()` from `handleKeyPress()` containing:
  - Tab/Shift+Tab focus navigation
  - Enter expand/collapse toggle
  - g/G viewport top/bottom jumps
  - Arrow keys and Page Up/Down viewport scroll
- Both normal and approval key paths now call `handleNavigationKey()`

**`client-apps/cli/pkg/executiontui/approval.go` (14 lines changed)**:
- Updated `handleApprovalKey()` to process only approval keys (a/s/r)
- All non-approval keys delegate to `handleNavigationKey()`:
  ```go
  default:
      // Not an approval key — delegate to navigation so the user can
      // Tab/Enter to expand tool blocks and scroll while deciding.
      return m.handleNavigationKey(msg)
  ```

**`client-apps/cli/pkg/executiontui/update_test.go` (26 lines changed)**:
- Renamed and updated `TestUpdate_FocusKeys_WorkDuringApproval` to verify Tab works during approval
- Updated `TestUpdate_gG_WorkDuringApproval` to verify g/G work during approval

### Behavioral Changes

| Tool Type | Collapsed State | Expanded State | During Approval |
|-----------|----------------|----------------|-----------------|
| Read | Header + 3 lines of file content | Full file content | Can expand/collapse |
| Write | Header + 3 lines of content being written | Full content being written | Can expand/collapse |
| Edit | Header + 3 lines of replacement text | Full replacement text | Can expand/collapse |
| Shell | Header + 3 lines of command output | Full command output | Can expand/collapse |
| ls/glob/grep | Header + comma-separated summary | Full result | Can expand/collapse |
| Delete | Header (path only) | N/A | Can scroll |
| Unknown/MCP | Header + 3 lines of result | Full result | Can expand/collapse |

### Example Output

Before (collapsed Write tool during approval):
```
  📝 Write: SKILL.md (11.0 KB, 384 lines) ⏸
```

After (collapsed Write tool during approval):
```
  📝 Write: SKILL.md (11.0 KB, 384 lines) ⏸
     │ # Agent Drafter
     │ Guide for creating valid Stigmer Agent YAML files...
     ⋮ 381 more lines
```

Users can now press Tab to focus the block, Enter to expand and see all 384 lines, scroll with arrow keys, then press `a`/`s`/`r` to approve/skip/reject.

## Benefits

1. **Instant content visibility**: Users see 3 lines of preview without any interaction, providing immediate context for approval decisions

2. **Correct content display**: Write tools now show what will be written (not confirmation messages), making the preview actually useful

3. **Full inspection capability**: Users can Tab/Enter to expand and review complete content before approving, eliminating blind approvals

4. **Consistent navigation**: All navigation keys work exactly the same during approval as they do normally — no learning curve or confusion

5. **Universal previews**: Shell and MCP tools now show content previews, not just file operation tools

6. **Clean architecture**: The `contentSource` enum makes tool display intent explicit and extensible — future `contentSourceBoth` can show both input and output

## Impact

### Users
- **HITL approval workflow**: Transformed from "blind approval based on header only" to "informed approval after inspecting content"
- **Shell tool visibility**: Can now see command output previews (first 3 lines) in collapsed state
- **MCP tool support**: Custom/MCP tools automatically get content previews without requiring explicit configuration

### Developers
- **Clear content-source semantics**: `contentSource` enum eliminates ambiguity about whether a tool displays input or output
- **Reusable preview logic**: `renderPreviewLines()` ensures consistent preview rendering across all code paths
- **Extensible framework**: Adding new tool types automatically inherits preview support

### Test Coverage
- All 129 toolrender tests pass
- 106/107 executiontui tests pass (1 pre-existing failure unrelated to changes)
- Updated tests verify navigation works during approval
- Both packages compile cleanly with no linter errors

## Related Work

This work addresses user feedback about the CLI's tool display that emerged during the HITL approval workflow testing. The changes are isolated to the CLI rendering layer and do not affect:
- Backend agent execution logic
- Proto definitions for tool calls
- gRPC streaming protocol
- Approval response handling

The `contentSource` framework is designed to be extended when tools need to display both input and output (future `contentSourceBoth` enum value).

---

**Status**: ✅ Production Ready
**Files Modified**: 5 (render.go, render_known.go, update.go, approval.go, update_test.go)
**Lines Changed**: +228 / -1196 (net -968, mostly deleted unused drafts)
**Test Coverage**: 235/236 tests passing
