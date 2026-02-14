# CLI Polish & Edge Cases: Approval Flags and Panel-Based Summaries

**Date**: February 14, 2026

## Summary

Completed T05 (Polish & Edge Cases) for the interactive CLI experience project. Wired the `--approve-default` flag for non-interactive CI/CD usage, upgraded execution completion display to use styled panels matching the approval UI, and made all panels terminal-width aware (capped at 100 columns). This closes the critical gap preventing automated pipeline usage and provides a cohesive visual experience from start to finish.

## Problem Statement

Three polish issues remained after T04:

1. **CI/CD blocker**: The error message "non-interactive mode requires --approve-default flag" referenced a flag that didn't exist. Any non-TTY execution hitting an approval would fail.

2. **Visual inconsistency**: Approval prompts used styled panels (added in T03), but execution completion used plain `cliprint.Print*` with ASCII separators. The UI felt disjointed.

3. **Terminal width blindness**: All panels used a fixed 70-column default width regardless of terminal size. Narrow terminals could overflow; wide terminals wasted space.

### Pain Points

- CI/CD pipelines couldn't auto-approve tool executions (flag didn't exist)
- Execution summaries looked disconnected from the polished approval UI
- Panels didn't adapt to terminal width
- No single authoritative width calculation for panels

## Solution

### 1. `--approve-default` flag (Sub-task 1)

Added `approval.ParseAction(string) (Action, error)` to convert CLI flag values (`"approve"`, `"skip"`, `"reject"`) to the `Action` enum. Threaded the parsed action through the entire call chain:

```
run.go / draft_skill.go (flag) 
  → executeRun / executeDraftSkill (parse) 
  → routeRun / direct call (pass) 
  → runAgent / runWorkflow (pass) 
  → streamAgentExecution / streamWorkflowExecution (pass) 
  → handleAgentApprovalPrompt / handleWorkflowApprovalPrompt (pass) 
  → buildPromptOptions (set DefaultAction)
```

**Behavior**:
- TTY + no flag: interactive prompt (unchanged)
- TTY + flag set: interactive prompt (flag ignored; user can override)
- Non-TTY + flag set: auto-resolves silently
- Non-TTY + no flag: error (now actionable -- flag actually exists)

### 2. Panel-based execution summary (Sub-task 2)

Extracted `displayAgentExecutionComplete` and `displayWorkflowExecutionComplete` from `run_display.go` into new `run_display_summary.go`. Rewrote both using `panel.Render` with outcome-based styles:

- **Success**: `panel.StyleSuccess` (green) with title "EXECUTION COMPLETE" / "WORKFLOW COMPLETE"
- **Failure**: `panel.StyleError` (red) with title "EXECUTION FAILED" / "WORKFLOW FAILED", error message prominently displayed first
- **Cancelled**: `panel.StyleWarning` (yellow) with title "EXECUTION CANCELLED" / "WORKFLOW CANCELLED"

Panel content:
- Agent: error (if failed), duration, messages, tool calls, artifacts
- Workflow: error (if failed), duration, task breakdown (total/completed/failed/skipped)

### 3. Terminal width awareness (Sub-task 3)

Created `summaryPanelWidth()` helper that caps terminal width at 100 columns. Applied to both approval panels (`run_display_approval.go`) and summary panels (`run_display_summary.go`). All panels now use `display.GetTerminalWidth()` with a 100-column cap for readability.

## Implementation Details

### New Files

**`pkg/approval/parse.go` (23 lines)**:
- `ParseAction(s string) (Action, error)` -- case-insensitive, whitespace-trimmed
- Returns descriptive error: `invalid approval action "X": must be one of: approve, skip, reject`

**`pkg/approval/parse_test.go` (117 lines)**:
- 5 test functions covering valid values, case insensitivity, whitespace handling, invalid values, error message format
- All 5 tests pass

**`cmd/stigmer/root/run_display_summary.go` (193 lines)**:
- Extracted completion display from `run_display.go`
- `summaryPanelWidth()` -- terminal width capped at 100
- `displayAgentExecutionComplete` / `displayWorkflowExecutionComplete` -- panel-based
- `agentSummaryTitleAndStyle` / `workflowSummaryTitleAndStyle` -- outcome-based styles
- `buildAgentSummaryContent` / `buildWorkflowSummaryContent` -- content builders
- `countWorkflowTasks` -- task breakdown helper
- `parseDuration` -- RFC3339 timestamp duration calculator

**`cmd/stigmer/root/run_display_summary_test.go` (409 lines)**:
- 24 test functions covering title/style selection, content building for all outcomes, task counting, duration parsing, panel output verification, width cap
- All 24 tests pass

### Modified Files

**Flag additions** (4 files):
- `run.go`: Added `approveDefault` flag and `ApproveDefault` field to `runOptions`
- `draft_skill.go`: Added `approveDefault` flag and field to `draftSkillOptions`
- Both flags have description: `"auto-resolve approval prompts in non-interactive mode (approve, skip, reject)"`

**Parsing and threading** (4 files):
- `run.go`: Parse flag with `approval.ParseAction()` in `executeRun`, thread through `routeRun`
- `draft_skill_handler.go`: Parse flag in `executeDraftSkill`, thread through streaming call
- `run_handlers.go`: Added `defaultAction approval.Action` parameter to `runAgent` and `runWorkflow`
- `run_stream.go`: Added `defaultAction` parameter to both stream functions, passed to approval handlers

**Approval handling** (1 file):
- `run_stream_approval.go`: Added `defaultAction` parameter to `handleAgentApprovalPrompt`, `handleWorkflowApprovalPrompt`, `buildPromptOptions`

**Panel rendering** (2 files):
- `run_display_approval.go`: Added `Width: summaryPanelWidth()` to approval panel options, added comment referencing shared width helper
- `run_display.go`: Removed completion functions (net -92 lines after import cleanup)

**Tests** (1 file):
- `run_stream_approval_test.go`: Added `approval.ActionUnspecified` to 5 test call sites for `buildPromptOptions` and approval handlers, added 2 new tests for `defaultAction` passthrough

**Build config** (2 files):
- `pkg/approval/BUILD.bazel`: Added `parse.go` to srcs, `parse_test.go` to test srcs
- `cmd/stigmer/root/BUILD.bazel`: Added `run_display_summary.go` to srcs, `run_display_summary_test.go` to test srcs

**Incidental whitespace fixes** (2 files):
- `pkg/spinner/spinner.go`: Aligned struct field indentation
- `pkg/toolrender/render.go`: Fixed trailing whitespace, removed extra newline

## Benefits

### For CI/CD pipelines:
- `stigmer run agent my-agent --approve-default approve` now works in non-TTY environments
- Clear error message when flag is missing guides users to the solution
- No interactive prompt attempts that would hang pipelines

### For visual consistency:
- Execution summaries match the polished approval panel aesthetic
- Success, failure, and cancellation states are instantly recognizable by color
- Completion feels like a natural bookend to the execution experience

### For terminal adaptability:
- Panels use available width on wide terminals (up to 100 columns)
- Panels don't overflow on narrow terminals
- Consistent width calculation across all panel renders

### For maintainability:
- SRP: `run_display.go` handles ongoing messages (157 lines), `run_display_summary.go` handles completion (193 lines)
- Shared `summaryPanelWidth()` helper eliminates duplication
- Comprehensive test coverage (29 new tests, 100% pass rate)

## Impact

### User-Facing

**Before**: Non-TTY executions crash on approval with "requires --approve-default flag" but flag doesn't exist. Completion summaries are plain text with ASCII separators.

**After**: CI/CD pipelines can auto-approve with `--approve-default approve`. Execution summaries are styled panels with outcome-based colors. All panels adapt to terminal width.

**Usage**: 
```bash
# CI/CD usage (new capability)
stigmer run agent code-reviewer --approve-default approve

# Development usage (unchanged, now consistent panels)
stigmer draft skill -m "Create X"
```

### Developer-Facing

- `approval.ParseAction()` is reusable for future CLI flags needing Action enum mapping
- `summaryPanelWidth()` establishes the pattern for all future panel width calculations
- Panel-based summaries provide extension points for future enhancements (e.g., execution links, artifact previews)

### Code Health

- All files remain under 250 lines (coding guideline compliance)
- 29 new tests with 100% pass rate
- No new dependencies or external packages
- Clean separation of concerns (parse in approval pkg, display in command layer)

## File Changes Summary

| Type | Count | Details |
|------|-------|---------|
| New source files | 2 | parse.go (23 lines), run_display_summary.go (193 lines) |
| New test files | 2 | parse_test.go (117 lines), run_display_summary_test.go (409 lines) |
| Modified source files | 11 | Flag wiring, threading, extraction, panel options |
| Modified test files | 1 | Updated call signatures (ActionUnspecified) |
| Modified BUILD files | 2 | Added new files to srcs/test srcs |
| **Net lines** | **+530** | (~526 test code, ~4 production after extraction) |

## Testing

All 29 new tests pass:
- 5 `ParseAction` tests (approval package)
- 24 summary display tests (root package)
- 2 `buildPromptOptions` with `defaultAction` tests
- All 58 pre-existing approval and display tests still pass

## Related Work

**Previous tasks in this project**:
- T02: Streaming-First Execution Engine (removed polling/streaming race)
- T03: Rich Approval Experience (Bubbletea panels with tool-aware formatting)
- T04: Live Progress & Structured Tool Display (spinner, toolrender packages)
- T05: Polish & Edge Cases (this changelog) -- CI/CD flag, panel summaries, terminal width

**Deferred work** (out of T05 scope):
- JSON streaming output mode (`--output json`) -- requires NDJSON schema design, deserves separate task
- Content truncation ("show more") -- premature; wait for user feedback on actual need
- Global error handler taxonomy -- current gRPC categorization is sufficient; execution errors from backend

---

**Status**: ✅ Complete

**Commit**: Next (after this changelog)

**Project Status**: T05 complete, interactive CLI experience project fully implemented (T02-T05 all done)
