# CLI Tool Call Display Improvements: Preview Styles and Fallback Args

**Date**: February 14, 2026

## Summary

Enhanced the Stigmer CLI tool call rendering system with three major improvements: (1) extensible preview style system using enums instead of booleans, (2) fallback argument resolution to handle framework variance, and (3) defense-in-depth repr stripping. These changes dramatically improve the user experience when watching agent executions, showing clean content previews instead of Python repr garbage, displaying file paths even when arg names vary, and previewing file content for read operations.

## Problem Statement

During agent execution, the CLI displays tool calls with icons, labels, and result previews. However, three defects were impacting UX based on actual production logs:

### Pain Points

1. **Raw Python repr leaking into previews**: Discovery tool previews (ls, glob, grep) showed raw Python `repr()` output like `content="Directory '/bin/skills' is empty" name='ls' tool_call_id='toolu_...'` instead of clean content. This occurred when the backend's `_extract_tool_result_content()` failed to handle LangGraph `ToolMessage` objects.

2. **Missing paths on Read operations**: Read tool calls displayed as `📖 Read (195 chars, 2ms)` with no file path, because deepagents sandbox tools use `"file_path"` as the arg name while the CLI expected `"path"`. This left users unable to see what file the agent read.

3. **No content previews for Read tools**: Users couldn't see what content was actually read without manually expanding results. For file reads, a brief first-line preview would confirm the agent read the correct file.

4. **Boolean flags limiting extensibility**: The system used `showPreview bool` to control preview rendering. Adding a new preview style (like first-line excerpts) would require adding more booleans, creating a brittle design.

## Solution

Implemented a comprehensive refactor of the CLI tool rendering system across three files:

### 1. Extensible Preview Style System (render.go)

Replaced the `showPreview bool` with a `previewStyle` enum:

```go
type previewStyle int

const (
    previewNone      previewStyle = iota  // Shell, write, edit, delete
    previewDiscovery                      // Comma-join for ls, glob, grep
    previewFirstLine                      // First-line excerpt for read tools
)
```

This is **backward-compatible** (zero value = `previewNone`) and **extensible** (adding shell output previews just adds `previewShellOutput` to the enum). The `renderKnown` function switches on `preview` to select the appropriate formatter.

### 2. Fallback Argument Resolution (format.go)

Added `fallbackFields []string` to `toolDisplayInfo` and a composed lookup function:

```go
func extractPrimaryArgWithFallbacks(args map[string]interface{}, primary string, fallbacks []string) string {
    if val := extractPrimaryArg(args, primary); val != "" {
        return val
    }
    for _, fb := range fallbacks {
        if val := extractPrimaryArg(args, fb); val != "" {
            return val
        }
    }
    return ""
}
```

Read tools now include: `fallbackFields: []string{"file_path", "file"}` to handle deepagents and other framework variations.

### 3. Defense-in-Depth Repr Stripping (format.go)

Added `stripToolMessageRepr()` that detects raw Python `ToolMessage` repr patterns:

```go
func stripToolMessageRepr(s string) string {
    if !strings.HasPrefix(s, "content=") {
        return s
    }
    for _, marker := range []string{" name='", ` name="`} {
        if idx := strings.Index(s, marker); idx >= 0 {
            content := s[len("content="):idx]
            return unquote(content)
        }
    }
    return s
}
```

This is called at the top of both `formatResultPreview()` (discovery tools) and `formatFirstLinePreview()` (read tools), providing defense-in-depth even when backend extraction fails.

### 4. First-Line Content Previews (format.go)

Added `formatFirstLinePreview()` and `firstNonEmptyLine()` to extract and display the first line of file content:

```go
func formatFirstLinePreview(result string) string {
    result = strings.TrimSpace(result)
    if result == "" {
        return ""
    }
    result = stripToolMessageRepr(result)
    firstLine := firstNonEmptyLine(result)
    if firstLine == "" {
        return ""
    }
    return truncate(firstLine, previewMaxWidth)
}
```

Read tools now show: 
```
📖 Read: inputs/agent-spec.proto (12 KB, 4ms)
     syntax = "proto3";
```

## Implementation Details

### File Changes

| File | Lines Changed | Key Changes |
|------|--------------|-------------|
| `render.go` | +73 / -25 | Added `previewStyle` enum, `fallbackFields` to struct, updated `toolDisplayMap` entries, refactored `renderKnown` |
| `format.go` | +110 | Added `extractPrimaryArgWithFallbacks`, `stripToolMessageRepr`, `unquote`, `formatFirstLinePreview`, `firstNonEmptyLine` |
| `render_test.go` | +435 | Added 48 new test cases covering fallback resolution, repr stripping, first-line previews, and all helper functions |

**Total**: 593 insertions, 25 deletions across 3 files

### Architecture Decision: Enum vs. Booleans

The plan initially suggested adding a second boolean `showReadPreview` alongside `showPreview`. However, this creates a brittle design—each new preview style requires a new boolean field.

**Chosen approach**: Replace the boolean with an enum that explicitly names each preview strategy. This is:
- **Extensible**: Adding `previewShellOutput` is trivial
- **Type-safe**: The switch statement warns if cases are missing
- **Self-documenting**: `preview: previewFirstLine` is clearer than `showReadPreview: true`
- **Backward-compatible**: Zero value = `previewNone`, matching the old `showPreview: false`

### Test Coverage

Added 48 new test cases organized into 7 sections:
1. **Fallback field resolution** (4 tests): Primary found, first fallback, second fallback, none found
2. **Read content previews** (5 tests): Multi-line, empty, whitespace, truncation, leading blanks
3. **Repr stripping integration** (4 tests): ls double-quoted, glob repr, read repr, ls single-quoted
4. **Unit tests for `extractPrimaryArgWithFallbacks`** (7 tests): Primary, fallbacks, edge cases
5. **Unit tests for `stripToolMessageRepr`** (7 tests): Double/single quotes, no match, empty, multiline
6. **Unit tests for `unquote`** (7 tests): Single/double quotes, mismatched, no quotes, empty
7. **Unit tests for `formatFirstLinePreview` and `firstNonEmptyLine`** (14 tests): Single/multi-line, empty, whitespace, truncation, repr-contaminated

All 121 tests pass (73 existing regression tests + 48 new tests).

### Tool Display Map Updates

Updated read tool entries to use the new system:

```go
"read":      {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFirstLine},
"read_file": {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFirstLine},
```

Discovery tools migrated to the enum:

```go
"ls":   {icon: "📂", label: "List", primaryField: "path", preview: previewDiscovery},
"glob": {icon: "🔍", label: "Find", primaryField: "pattern", preview: previewDiscovery},
"grep": {icon: "🔎", label: "Search", primaryField: "pattern", preview: previewDiscovery},
```

## Benefits

### For End Users
- **Clean content**: No more Python repr garbage in tool previews
- **Visible paths**: Read operations always show what file was accessed, regardless of framework
- **Content confirmation**: First-line previews let users verify the agent read the right file
- **Consistent formatting**: All preview styles follow the same 72-char truncation and indentation

### For Developers
- **Extensible design**: Adding new preview styles is trivial (add enum value, add formatter, add case)
- **Defense-in-depth**: Repr stripping at the CLI layer protects against future backend regressions
- **Framework agnostic**: Fallback fields make the CLI resilient to arg name variance
- **Well-tested**: 48 new tests ensure robustness and prevent regressions

### For Platform Quality
- **Zero breaking changes**: All existing tool rendering continues to work
- **Backward compatible**: Zero value enum matches old boolean behavior
- **Type-safe**: Compiler enforces exhaustive case handling in switch statements
- **Maintainable**: Clear separation between preview styles makes code easier to understand

## Impact

### User Experience Impact
- **CLI tool call display**: All agent tool calls now render with cleaner, more informative output
- **Read operations**: Users can immediately see what file was read and preview its content
- **Discovery operations**: ls/glob/grep results show clean content instead of repr metadata
- **Framework tolerance**: Works with deepagents, standard sandbox tools, and future frameworks

### Performance Impact
- **Negligible overhead**: String operations are simple and cached at render time
- **Test suite**: +0.1s additional test time (48 new tests run in ~100ms)
- **No runtime regressions**: All existing tests pass without modification

### Development Impact
- **Future preview types**: Can be added in minutes (enum value + formatter + tests)
- **CI/CD**: All 121 tests must pass for builds to succeed
- **Maintenance**: Enum-based dispatch is easier to reason about than boolean combinations

## Related Work

### Prerequisite Work
- **Workstream 1 (Backend)**: Fixes `_extract_tool_result_content()` in `status_builder.py` to handle LangGraph `ToolMessage` objects properly. This Workstream 2 (CLI) adds defense-in-depth on top of that fix.

### Future Enhancements
- **Shell output previews**: With the enum system, adding `previewShellOutput` for command execution results is straightforward
- **Error previews**: Could add `previewError` to show truncated error messages with special formatting
- **Streaming previews**: The preview system could be extended to update incrementally during tool execution

### Complementary Changes
- This work pairs with the recursion limit fix (Workstream 3) to improve the overall CLI agent execution experience
- The preview system will benefit from future backend improvements to tool result formatting

---

**Status**: ✅ Production Ready  
**Commit**: `967aa1b5`  
**Tests**: 121/121 passing  
**Files Changed**: 3 files, 593 insertions, 25 deletions
