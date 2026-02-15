# Enhanced CLI Read Tool Display with Multi-Line Gutter Preview

**Date**: February 14, 2026

## Summary

Transformed the CLI read tool output from a single-line preview to a rich, multi-line gutter-bordered display that shows 3 lines of file content with a visual boundary and "N more lines" indicator. This change significantly improves the developer experience when watching agent executions, making it easier to distinguish between files and understand what the agent is reading without overwhelming the terminal.

## Problem Statement

The CLI's read tool display showed only the first line of file content as a preview, creating several UX pain points that degraded the observability of agent execution.

### Pain Points

- **Indistinguishable files**: Multiple proto files all displayed `syntax = "proto3";` as their first line—impossible to tell them apart in a stream of 5+ file reads
- **No visual separation**: The preview line blended with surrounding agent prose, making it hard to track what was a file preview vs. conversational output
- **Inadequate metadata**: Displayed "1.0 KB" instead of "33 lines"—developers think in line counts, not byte sizes
- **No content signal**: No indication that more content existed beyond the single preview line
- **Below industry standard**: Tools like Cursor and Claude Code show multi-line previews; our single-line approach was below the UX bar for a world-class platform

## Solution

Implemented a three-line gutter-bordered preview with line count metadata and overflow indicators:

**Before:**
```
  📖 Read: inputs/agent-api.proto (1.0 KB, 1ms)
     syntax = "proto3";
```

**After:**
```
  📖 Read: inputs/agent-api.proto (1.0 KB, 33 lines, 1ms)
     │ syntax = "proto3";
     │ 
     │ package ai.stigmer.agentic;
     ⋮ 30 more lines
```

The gutter (`│`) creates an unmistakable visual boundary, the 3-line preview shows differentiating content, and the vertical ellipsis (`⋮`) signals additional content using a familiar IDE convention.

## Implementation Details

### Architecture

Created a new `previewFileContent` style that extends the existing `previewStyle` abstraction without breaking existing tools (ls, grep, shell remain unchanged).

### New Components

1. **`file_preview.go`** (~110 lines)
   - `formatFileContentPreview()`: Core multi-line renderer with gutter formatting
   - `countLines()`: Line counting for metadata
   - `formatLineCount()`: Human-readable line count formatting ("1 line" vs "33 lines")
   - Constants: `filePreviewMaxLines=3`, `gutterPrefix`, `ellipsisPrefix`

2. **`file_preview_test.go`** (21 tests, ~170 lines)
   - Empty/whitespace handling
   - Single/multi-line files
   - Trailing blank line trimming
   - All-blank fallback logic
   - Long line truncation
   - Repr stripping defense
   - Line counting edge cases
   - Gutter alignment verification

### Modified Components

1. **`render.go`**
   - Added `previewFileContent` enum value
   - Updated `read`/`read_file` in `toolDisplayMap` to use new preview style
   - Refactored `renderSuffix()` → `renderSuffix()` + `buildSuffix(tc, lineCount)` to support optional line count
   - Enhanced `renderKnown()` to compute line count for file tools and render multi-line gutter preview

2. **`render_test.go`**
   - Updated 7 read-related tests to expect multi-line gutter format
   - Added assertions for line count in suffix
   - Added assertions for "N more lines" indicator
   - Verified gutter character presence

### Key Design Decisions

- **3-line preview**: Enough to show differentiating content without overwhelming streaming output
- **Gutter alignment**: 5-space indent + `│` + space matches the tool call header column
- **Ellipsis indicator**: Uses `⋮` (vertical ellipsis, U+22EE), aligned with gutter column, familiar from IDE collapsed regions
- **Trailing blank trimming**: Avoids wasting vertical space on empty lines at preview boundary
- **Fallback for all-blank**: If first 3 lines are all blank, fall back to first non-empty line
- **Line count placement**: Inserted between size and duration in suffix for logical flow: `(1.0 KB, 33 lines, 1ms)`

### Engineering Standards Compliance

- **Single Responsibility**: `file_preview.go` has exactly one concern—file content preview formatting
- **File size**: All files under 250 lines (new files ~110 and ~170 lines)
- **Interface segregation**: Extended existing `previewStyle` enum rather than replacing patterns
- **Zero backend changes**: Pure CLI presentation layer, no proto or backend deployment required
- **Dependency injection**: Reuses existing `dimStyle`, `truncate`, `firstNonEmptyLine` from the package
- **Error handling**: All edge cases handled (empty files, whitespace-only, repr contamination)

## Benefits

### Immediate UX Improvements

- **Distinguishable files**: Proto files now show package declarations in line 3, making them instantly recognizable
- **Visual clarity**: Gutter creates unmistakable separation between file content and agent prose
- **Better metadata**: "33 lines" is more meaningful than "1.0 KB" for developers reviewing read operations
- **Content awareness**: "30 more lines" indicator signals file size without showing full content
- **Terminal efficiency**: 3 lines + indicator takes 4 terminal lines total—compact enough for rapid streaming without overwhelming

### Developer Experience

- **Faster debugging**: When an agent reads the wrong file, the 3-line preview immediately reveals the error
- **Confidence in execution**: Richer preview confirms the agent is reading the expected content
- **Reduced context switching**: Developers don't need to open files to verify agent reads—preview shows enough context

### Platform Quality

- **Industry standard**: Now matches the multi-line preview UX of Cursor and Claude Code
- **Extensible foundation**: The `previewFileContent` style can be tuned (increase to 5 lines) via a single constant
- **Testing rigor**: 21 new tests + 7 updated tests ensure robust behavior across edge cases

## Test Results

All 110 tests pass, including:
- 21 new tests in `file_preview_test.go`
- 7 updated tests in `render_test.go`
- 82 existing tests remain unchanged and passing

Full CLI build compiles cleanly with zero errors or warnings.

## Impact

### Who Is Affected

- **Agent users**: Anyone watching agent executions via `stigmer run` sees improved read tool output
- **Developers debugging agents**: Clearer visibility into file reads during troubleshooting
- **Platform QA**: More informative logs when verifying agent behavior

### Compatibility

- **Zero breaking changes**: Existing tools (ls, grep, shell) unchanged
- **Forward compatible**: Line count metadata is additive—older code that doesn't expect it will ignore it
- **CLI-only**: No backend deployment required, safe to roll out independently

### Scale

- **Low risk**: Pure presentation layer change with comprehensive test coverage
- **High value**: Improves UX of one of the most frequently used tool calls (file reading is ~30% of agent tool use)

## Related Work

- **CLI Engineering Standards** (`client-apps/cli/.cursor/rules/coding-guidelines.mdc`): This implementation follows all mandatory principles—SRP, interface segregation, dependency injection, error handling
- **Tool Rendering Architecture** (`pkg/toolrender/`): Extends the existing `previewStyle` abstraction without breaking existing tools
- **Future Enhancement**: The `previewFileContent` style can be extended to other tools (e.g., write, edit) if preview becomes valuable for those operations

---

**Status**: ✅ Production Ready  
**Files Changed**: 4 (2 new, 2 modified)  
**Test Coverage**: 110 tests passing (21 new, 7 updated)  
**Lines of Code**: ~280 lines added (implementation + tests)
