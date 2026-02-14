# CLI Agent Tool Display UX Improvements

**Date**: February 14, 2026

## Summary

Fixed five critical UX issues in the Stigmer CLI's agent execution streaming display, eliminating corrupted output, adding tool recognition for all platform tools, providing result previews for discovery tools, and fixing tool naming inconsistencies between backend and prompts. The CLI now provides a clean, informative real-time view of agent activity that makes it easy to understand what the agent is doing and what it found.

## Problem Statement

The CLI's agent execution streaming had severe UX issues that made it difficult for users to understand what agents were doing. When running `stigmer draft skill`, users saw corrupted output where spinner animations appeared on the same line as tool calls, cryptic "🔧 glob" labels with no explanation of what the tool does, no visibility into what files were found by discovery tools, and phantom tool calls to non-existent tools like `read_file`.

### Pain Points

- **Corrupted output**: Lines like `⠋ Agent is thinking... (5s)  📖 Read (195 chars, 0ms)` where spinner frames and tool calls appeared on the same line, making output unreadable
- **Unrecognized tools**: Platform tools `ls`, `glob`, `grep`, `edit` fell through to generic `🔧 unknown_tool` rendering, leaving users confused about what these tools do
- **No result visibility**: For discovery tools like `ls` and `glob`, only `(97 chars, 3ms)` was shown -- users had no idea what files were found without scrolling through verbose logs
- **Naming inconsistency**: Backend defined tools as `read`, `write`, `edit`, but prompts told LLMs to call `read_file`, `write_file`, `edit_file`, causing phantom tool invocations
- **Transient indicator didn't disappear**: The "Agent is thinking..." spinner was supposed to disappear when tools executed (like Cursor's UX), but concurrent writes prevented the clear from working

## Solution

Implemented a multi-layered fix addressing renderer timing, tool recognition, result previews, and naming consistency:

### 1. Spinner/Renderer Race Condition Fix

Added `hasPending()` method to `messageStreamRenderer` that checks whether the next `render()` call will produce output. The streaming loop now stops the spinner **before** calling `render()` when pending content exists, preventing concurrent stdout writes that corrupt display lines.

### 2. Complete Platform Tool Registration

Added all 7 platform tools to `toolDisplayMap` with appropriate icons and labels:
- `ls` → `📂 List`
- `glob` → `🔍 Find`
- `grep` → `🔎 Search`
- `edit` → `✏️ Edit`
- `execute` → `🖥 Execute`

Separated `edit` from the write category into its own distinct category.

### 3. Result Preview for Discovery Tools

Added `showPreview` flag to `toolDisplayInfo` and `formatResultPreview()` helper. Discovery tools (`ls`, `glob`, `grep`) now display a second dimmed line below the tool header with a truncated, comma-separated result preview. Multi-line results are joined compactly; single-line messages pass through directly.

### 4. Tool Name Normalization

Fixed all prompt/documentation references to use actual tool names (`read`, `write`, `edit`) instead of non-existent `read_file`, `write_file`, `edit_file`. Updated 6 files across the graphton library and test suite.

## Implementation Details

### Frontend (Go CLI)

**Modified Files:**
- `client-apps/cli/cmd/stigmer/root/run_stream.go` - Pre-stop spinner when content pending
- `client-apps/cli/cmd/stigmer/root/run_display_stream.go` - Added `hasPending()` method
- `client-apps/cli/pkg/toolrender/render.go` - Registered platform tools, added preview rendering
- `client-apps/cli/pkg/toolrender/format.go` - Added `formatResultPreview()` helper

**Key Code Change** - Spinner timing fix:

```go
// BEFORE: Spinner stopped AFTER rendering (caused corruption)
rendered, streaming := renderer.render(execution.Status.Messages)
if rendered {
    sp.Stop()
}

// AFTER: Spinner stopped BEFORE rendering (clean output)
if renderer.hasPending(execution.Status.Messages) {
    sp.Stop()
}
rendered, streaming := renderer.render(execution.Status.Messages)
```

**Key Code Change** - Result preview:

```go
// In renderKnown() - append preview line for discovery tools
if info.showPreview && tc.Result != "" {
    preview := formatResultPreview(tc.Result)
    if preview != "" {
        line += "\n" + dimStyle.Render("     "+preview)
    }
}
```

### Backend (Python Graphton)

**Modified Files:**
- `backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py` - Tool name fixes in prompts
- `backend/libs/python/graphton/src/graphton/core/error_hints.py` - Tool name fixes in recovery hints
- `backend/libs/python/graphton/README.md` - Tool name fixes in documentation

**Before/After Tool Names:**
```
BEFORE: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`
AFTER:  `ls`, `read`, `write`, `edit`, `glob`, `grep`
```

### Testing

Added 23 new tests across 2 test files:
- **12 new tests** in `render_test.go` - Platform tool recognition, result preview, preview truncation
- **5 new tests** in `run_display_stream_test.go` - `hasPending()` method coverage
- **6 new tests** in `render_test.go` - `formatResultPreview()` helper validation

All tests pass. Full CLI binary builds successfully.

## Benefits

**For Users:**
- **Clean output**: No more corrupted lines with spinner frames mixed into tool calls
- **Clear tool labels**: Instantly understand what `ls`, `glob`, `grep` do without guessing
- **Immediate visibility**: See what files were found/listed without digging through logs
- **Reliable tool calls**: No more phantom tool invocations that fail silently

**For Maintainers:**
- **Consistent naming**: Single source of truth for tool names
- **Extensible design**: `showPreview` flag makes it easy to add previews for future tools
- **Proper separation of concerns**: Spinner timing logic separated from rendering logic
- **Comprehensive test coverage**: 23 new tests guard against regressions

**Concrete Impact:**
```
BEFORE (corrupted output):
⠋ Agent is thinking... (5s)  📖 Read (195 chars, 0ms)
⠴ Agent is thinking... (2s)  🔧 glob: **/init_skill.py (165 chars, 1ms)
⠦ Agent is thinking... (2s)  🔧 ls: / (206 chars, 1ms)

AFTER (clean output):
  📖 Read: inputs/requirements.md (195 chars, 0ms)

  🔍 Find: **/init_skill.py (165 chars, 1ms)
     No files matching pattern '**/init_skill.py'

  📂 List: / (206 chars, 1ms)
     bin, etc, home, opt, tmp, usr, var, workspace
```

## Impact

**User Experience:**
- Dramatically improved readability of agent execution logs
- Reduced cognitive load -- users can immediately understand agent activity
- Faster debugging -- tool results visible inline without separate log inspection
- Professional polish matching world-class CLI tools

**Developer Experience:**
- Consistent tool naming eliminates confusion when writing agent prompts
- Preview system provides template for future rich result display
- Comprehensive tests enable confident refactoring

**Scope:**
- Affects all CLI commands that stream agent execution (`draft skill`, `run agent`, etc.)
- Affects all agent prompts (now reference correct tool names)
- Affects all agents using platform tools (read, write, edit, ls, glob, grep)

## Related Work

This change builds on:
- Streaming execution architecture introduced in earlier CLI work
- Delta-based message rendering for incremental AI response display
- Approval flow integration in agent execution

Future opportunities:
- Terminal hyperlinks (OSC 8) for file paths when web execution viewer is available
- Syntax highlighting for tool results (e.g., colored `ls -la` output)
- Interactive result expansion (collapse/expand long results)
- Structured diff previews for `edit` tool operations

---

**Status**: ✅ Production Ready
**Timeline**: Single session implementation (~2 hours planning + implementation + testing)
