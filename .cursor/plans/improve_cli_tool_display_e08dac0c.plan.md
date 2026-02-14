---
name: Improve CLI tool display
overview: "Fix five interconnected issues in the CLI's agent execution display: spinner/tool output interleaving, unrecognized platform tools, missing result previews, read/read_file naming inconsistency, and confusing tool labels."
todos:
  - id: fix-spinner-interleaving
    content: "Fix spinner/renderer output interleaving: add `hasPending()` to renderer, pre-stop spinner in `run_stream.go` before rendering when pending content exists"
    status: completed
  - id: register-platform-tools
    content: Add `ls`, `glob`, `grep`, `edit`, `execute` to `toolDisplayMap` with proper icons, labels, and primaryField values
    status: completed
  - id: add-result-preview
    content: "Add `showPreview` flag to `toolDisplayInfo` and result preview rendering for discovery tools (`ls`, `glob`, `grep`): format truncated result as dimmed second line"
    status: completed
  - id: fix-prompt-tool-names
    content: "Fix tool name inconsistency in `prompt_enhancement.py`: change `read_file` -> `read`, `write_file` -> `write`, `edit_file` -> `edit`"
    status: completed
  - id: update-tests
    content: Add tests for new `ls`/`glob`/`grep` tool entries, result preview rendering, and `hasPending()` method
    status: completed
isProject: false
---

# Improve CLI Agent Tool Display UX

## Problem Diagnosis

Analyzing the logs from the `stigmer draft skill` invocation reveals five distinct issues, all rooted in how the CLI renders tool activity during agent execution streaming.

### Issue 1: Spinner corrupts tool output lines (Critical Bug)

Lines like `⠋ Agent is thinking... (5s)  📖 Read (195 chars, 0ms)` show the spinner frame and the tool call on the **same line**. Root cause: in `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`, `renderer.render()` writes to stdout **while the spinner goroutine is still active**. The spinner writes `\r⠋ Agent is thinking...` (carriage return, no newline), and then the renderer appends tool call output to the same line.

```79:86:client-apps/cli/cmd/stigmer/root/run_stream.go
		rendered, streaming := renderer.render(execution.Status.Messages)
		if rendered {
			sp.Stop()
		}
		if rendered && !streaming {
			// Batch of complete messages finished — restart spinner while waiting.
			sp.Start("Agent is thinking...")
		}
```

`sp.Stop()` happens **after** `renderer.render()` writes output -- it must happen **before**.

### Issue 2: `ls`, `glob`, `grep` are not recognized tools

The `[toolDisplayMap](client-apps/cli/pkg/toolrender/render.go)` has entries for `read`, `read_file`, `list_directory`, `shell`, etc. -- but NOT for the actual platform tool names `ls`, `glob`, `grep`, or `edit`. These fall through to `renderUnknown()`, producing cryptic output like `🔧 glob: **/init_skill.py` -- the user has no idea what "glob" means.

The actual platform tools (defined in `[tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py)`) are: `read`, `ls`, `glob`, `grep`, `write`, `edit`, `execute`.

### Issue 3: No result preview for discovery tools

For `ls` and `glob`, the **result is the primary value** -- the user needs to know what files were found. Currently, only `(97 chars, 3ms)` is shown. The `Result` field IS populated in the ToolCall proto (proven by the char count in the suffix), so we have the data to show a preview.

### Issue 4: `read` vs `read_file` naming inconsistency

The actual backend tool is named `read`, but `[prompt_enhancement.py](backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py)` tells the LLM about `read_file`, `write_file`, `edit_file`. The LLM then sometimes calls `read_file` (a non-existent tool). The execution summary confirms this: `glob x1, ls x2, read x5, read_file x2` -- 2 calls to a phantom tool.

### Issue 5: "Agent is thinking..." lacks transient-then-replace behavior

The user expects the thinking indicator to **disappear when a tool executes**, similar to Cursor's UX. This is already the design intent (the spinner clears on `sp.Stop()`), but Issue 1 prevents it from working correctly.

---

## Design Decisions

### Spinner management: Pre-check before render (no flicker)

Rather than unconditionally stopping the spinner before every render (which would cause visible flicker on every 500ms stream update), add a `hasPending()` method to the renderer. Only stop the spinner when there's actually content to render.

```go
// New method on messageStreamRenderer
func (r *messageStreamRenderer) hasPending(messages [...]) bool {
    return r.inStream || len(messages) > r.displayedCount
}
```

### Result preview: Second dimmed line for discovery tools

For `ls`, `glob`, `grep` -- show a second indented, dimmed line below the tool header with a truncated result preview. Only when `Result` is non-empty and the tool is marked as `showPreview`. Example:

```
  📂 List: /workspace (97 chars, 3ms)
     inputs/, outputs/

  🔍 Find: **/init_skill.py (165 chars, 1ms)
     No files matching pattern '**/init_skill.py'
```

This is NOT a new line format -- it's an enhancement to the existing `Render()` return value. The caller already uses `fmt.Fprintln()`, so a multi-line return works transparently.

### File hyperlinks: Future enhancement (noted, not implemented)

The user asked about clickable file links. Since these are remote sandbox files (not local), there's no target to link to without a web execution viewer. Terminal hyperlinks (OSC 8) could work if we add a web UI for file viewing later. For now, we ensure paths are clearly displayed and distinguishable.

---

## Implementation Plan

### File Changes


| File                                                                                            | Change                                                                                                    |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `[run_stream.go](client-apps/cli/cmd/stigmer/root/run_stream.go)`                               | Stop spinner before rendering when content is pending                                                     |
| `[run_display_stream.go](client-apps/cli/cmd/stigmer/root/run_display_stream.go)`               | Add `hasPending()` method                                                                                 |
| `[toolrender/render.go](client-apps/cli/pkg/toolrender/render.go)`                              | Register `ls`, `glob`, `grep`, `edit`, `execute`; add `showPreview` support; add result preview rendering |
| `[toolrender/format.go](client-apps/cli/pkg/toolrender/format.go)`                              | Add `formatResultPreview()` helper                                                                        |
| `[toolrender/render_test.go](client-apps/cli/pkg/toolrender/render_test.go)`                    | Tests for new tool entries and result previews                                                            |
| `[prompt_enhancement.py](backend/libs/python/graphton/src/graphton/core/prompt_enhancement.py)` | Fix `read_file` -> `read`, `write_file` -> `write`, `edit_file` -> `edit`                                 |


### Target Output

Before (current broken output):

```
⠋ Agent is thinking... (5s)  📖 Read (195 chars, 0ms)
⠴ Agent is thinking... (2s)  🔧 glob: **/init_skill.py (165 chars, 1ms)
⠦ Agent is thinking... (2s)  🔧 ls: / (206 chars, 1ms)
⠏ Agent is thinking... (2s)  🔧 ls: /workspace (97 chars, 3ms)
```

After (corrected output):

```
  📖 Read: some/file.py (195 chars, 0ms)

  🔍 Find: **/init_skill.py (165 chars, 1ms)
     No files matching pattern '**/init_skill.py'

  📂 List: / (206 chars, 1ms)
     bin, etc, home, opt, tmp, usr, var, workspace

  📂 List: /workspace (97 chars, 3ms)
     inputs, outputs
```

