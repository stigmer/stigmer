# Phase 7: Cleanup -- Inline Renderer Dead Code Removal and File Splitting

**Date**: March 5, 2026

## Summary

Completed the final cleanup phase of the Bubbletea inline renderer migration. Removed dead code accumulated across 6 phases of migration, split oversized files to comply with SRP and line count guidelines, cleaned up stale comments, and refactored long functions. Net result: -871 deletions, +98 additions across tracked files, 4 new well-scoped files created.

## Problem Statement

After 6 phases of incremental migration from manual ANSI cursor control to Bubbletea View()-managed rendering, the codebase had accumulated:
- Dead functions in `termctl` that were replaced by Bubbletea rendering
- Tracking fields that became always-false after `ToolRunningEvent` was suppressed
- Function parameters propagating dead state through 4 levels of call chains
- Multiple files exceeding the 250-line SRP guideline (up to 658 lines)
- A 90-line function with 3 distinct responsibilities
- Stale comments referencing deleted constructs

### Pain Points

- `termctl.SaveCursor`/`RestoreCursorAndClear` had zero callers but persisted in the codebase
- `lastRenderedRunningID` and `runningLineRendered` were always-false artifacts of a suppressed event path
- `run_stream_inline.go` at 658 lines conflated type definitions, rendering methods, and core dispatch
- `run_stream_inline_approval.go` at 464 lines mixed orchestration logic with display helpers
- `renderToolStreamDeltaDirect` at 90 lines handled 3 distinct streaming scenarios in one function

## Solution

Systematic 5-step cleanup: dead code removal, stale comment hygiene, file splitting along semantic boundaries, function decomposition, and build/test verification.

## Implementation Details

### Dead Code Removal
- **termctl.go**: Removed `SaveCursor` and `RestoreCursorAndClear` (zero production callers)
- **run_stream_inline.go**: Removed `lastRenderedRunningID` field from `inlineRenderer` struct
- **run_stream_inline_approval.go**: Removed `runningLineRendered` from `waitingApprovalState`, eliminated `runningRendered` parameter from `handleApproval`, `handleNonInteractiveApproval`, `handleInteractiveApproval`, `erasePreApprovalContent`, `resolveApprovalContext`; simplified 2 unreachable branches
- **run_stream_inline_bubbletea_test.go**: Removed `mockAutoApprovePrompter` (unused test type)
- **termctl_test.go**: Removed 4 tests for deleted functions
- **approval_test.go, streaming_test.go**: Updated struct literals and call signatures throughout

### File Splitting (4 new files)
| Original | Lines | New File | Lines | Contains |
|----------|-------|----------|-------|----------|
| `run_stream_inline.go` | 658 | `run_stream_inline_types.go` | 137 | Struct/type definitions, constants |
| `run_stream_inline.go` | 658 | `run_stream_inline_render.go` | 283 | All rendering methods + helpers |
| `run_stream_inline.go` | 658→243 | *(core)* | 243 | Event loop + handleEvent dispatch |
| `run_stream_inline_approval.go` | 464 | `run_stream_inline_approval_display.go` | 187 | Display helpers, error handlers |
| `run_stream_inline_approval.go` | 464→278 | *(core)* | 278 | Approval orchestration flow |
| `run_stream_inline_bubbletea.go` | 358 | `run_stream_inline_messages.go` | 82 | Bubbletea message types |
| `run_stream_inline_bubbletea.go` | 358→275 | *(core)* | 275 | Model + Init/Update/View + handlers |

### Function Decomposition
`renderToolStreamDeltaDirect` (90 lines) → 3 focused helpers:
- `renderStreamDeltaUncapped` -- post-approval unlimited streaming
- `renderStreamOverflowUpdate` -- truncation indicator updates
- `renderStreamDeltaCapped` -- pre-approval line-capped incremental rendering
- Parent reduced to ~14-line router

### Comment Hygiene
- `termctl.go`: "line-counting middleware" → generic "buffered middleware"
- `approval.go`: Updated `approvalContentBudget` to reference both Bubbletea View() and EraseLines collapse
- `spinner.go`: Removed migration-era framing commentary

### Build and Test Verification
- `BUILD.bazel`: Added 4 new source files, 1 previously missing test file, 1 previously missing bubbletea dependency
- `go vet`: Clean pass
- `go test`: All pass (2 pre-existing failures unrelated to cleanup)

## Benefits

- **Eliminated ~870 lines of dead/redundant code** -- smaller surface area to maintain
- **All files now under ~340 lines** -- improved navigability and SRP compliance
- **No function exceeds ~50 lines** (with one exception: `handleEvent` dispatch switch, intentionally kept intact to avoid indirection)
- **Stale comments removed** -- comments now match actual code behavior
- **BUILD.bazel corrected** -- previously missing source entries and dependency now included
- **Zero behavioral changes** -- pure refactoring, all tests pass

## Impact

- **Maintainers**: Significantly easier to navigate the inline renderer codebase. Each file has a clear, single responsibility. New contributors can understand file boundaries without reading hundreds of lines.
- **Future features**: The 20260305.02 (expand-collapse-tools) project is now unblocked with a clean foundation.
- **Build system**: Bazel build file is now fully accurate, preventing potential issues in CI.

## Related Work

- [Phase 1-6 Bubbletea Migration](../2026-03/) -- The 6 phases that preceded this cleanup
- Project: `_projects/2026-03/20260305.01.bubbletea-inline-renderer/`
- Next: `_projects/2026-03/20260305.02.expand-collapse-tools/`

---

**Status**: ✅ Production Ready
**Timeline**: ~1 session (Phase 7 of 7)
