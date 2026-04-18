# Task T01: Inline-First CLI — Full Implementation Plan

**Created**: 2026-03-04
**Status**: APPROVED
**Reviewed**: 2026-03-04 (all design decisions finalized)

## Context

Phases 1 and 2 of the `cli-tui-ux-hardening` project established a solid inline renderer
(`run_stream_inline.go`, 382 lines) with two-lane stdout/stderr separation, and the full
alt-screen TUI remains available. However, the default experience is still alt-screen TUI
when a TTY is detected.

After reviewing Claude Code's terminal UX — which runs entirely inline without alt-screen —
we've identified that the inline-first approach is fundamentally better for our MVP:

1. **Scrollback preserved** — users can see everything after completion
2. **No terminal corruption risk** — eliminates the entire class of bugs that Phase 1.4
   was built to solve
3. **Simpler mental model** — output flows naturally, no modes or viewports
4. **Compact tool rendering** — Claude Code proves that one-line read summaries, compact
   previews, and natural grouping work better than 3-line gutter-bordered previews

### Current State of Inline Renderer

| Aspect | Current | Target |
|--------|---------|--------|
| Default mode (TTY) | `OutputInteractive` (alt-screen) | `OutputInline` (no alt-screen) |
| Read tool | 📖 icon + path + 3-line gutter preview | `● Read(path)` + `Read N lines` (clickable path) |
| Write/Edit tool | 📝 icon + path + 3-line gutter preview | Compact header + short preview (clickable path) |
| Shell tool | 🖥 icon + command + 3-line gutter preview | Command + exit code + truncated output |
| File paths | Plain text, not clickable | OSC 8 hyperlinks, click to open in editor |
| Sub-agent | Single start/complete lines | Indented tool calls grouped under header |
| Approval | Bubbletea ↑↓ menu (heavy) | Expanded content + arrow-key menu + cursor-collapse (Claude Code style) |
| Follow-up | Not supported (exits on completion) | Simple readline prompt after completion |
| Multiple reads | Individual 3-line blocks | Grouped: `Read N files (ctrl+e to expand)` |

### Files in Scope

| Package | Key Files |
|---------|-----------|
| `cmd/stigmer/root/` | `output_mode.go`, `run_stream_inline.go`, `run_stream.go`, `run_session.go`, `run_stream_events.go` |
| `pkg/toolrender/` | `render.go`, `render_compact.go`, `hyperlink.go`, `file_preview.go` |
| `pkg/approval/` | `interactive.go`, `prompt_model.go`, `inline_prompter.go` (new), `formatter.go` |
| `pkg/termctl/` | `termctl.go` (new) — ANSI cursor control primitives |

### Reference: Claude Code's Tool Rendering

From the screenshot and research:

```
● Read(README.md)
    Read 77 lines
● Read(stigmer.yaml)
    Read 12 lines
● Bash(find /Users/... -type f | sort)
    /path/to/file1.md
    /path/to/file2.md
    /path/to/file3.md
    ... +41 lines (ctrl+e to expand)
```

Key patterns:
- Green bullet `●` prefix for each tool call
- Tool name + primary argument on line 1 — **file paths are clickable terminal hyperlinks**
- Indented result summary on line 2+
- Reads: just filename + line count (no content preview) — click the path to open the file
- Shell/Bash: command + truncated output + "N more lines" expand hint
- Multiple sequential reads can be grouped into `Read N files (ctrl+e to expand)`
- Writes/Edits: show content/diff (mutations are important to verify)

**Clickable paths are the key UX insight**: By making file paths OSC 8 hyperlinks
(`\033]8;;file:///absolute/path\033\\display\033]8;;\033\\`), users can click to
open any file the agent touched. This compensates for not showing content inline —
the content is one click away. Works in iTerm2, Wezterm, Kitty, Ghostty, Hyper,
and most modern terminals. Gracefully degrades to plain text in unsupported terminals.

---

## Phase 1: Flip Default to Inline

**Effort**: Small (< 1 hour)

### 1.1 Change Default Output Mode

In `output_mode.go` → `resolveOutputMode()`:

```
Current priority:
  --json      → OutputJSON
  --no-tui    → OutputInline
  non-TTY     → OutputInline
  TERM=dumb   → OutputInline
  TTY         → OutputInteractive  ←  change this

New priority:
  --json      → OutputJSON
  --tui       → OutputInteractive  ←  new flag
  --no-tui    → (remove or keep as alias)
  non-TTY     → OutputInline
  TERM=dumb   → OutputInline
  TTY         → OutputInline       ←  new default
```

**Changes**:
- Add `--tui` flag (boolean) to opt into alt-screen TUI
- Default TTY → `OutputInline`
- `--no-tui` becomes a no-op (or remove it with a deprecation notice)
- Register `--tui` on `run` and `draft` commands

**Files**: `output_mode.go`, `run.go`, `draft.go`
**Tests**: Update tests that assume TTY → `OutputInteractive`

---

## Phase 2: Compact Tool Rendering (Claude Code Style)

**Effort**: Medium (2-3 sessions)

This is the core of the project — four UI surfaces to perfect.

### 2.0 Clickable File Paths (Cross-Cutting)

**Every file path** rendered by the inline renderer must be a clickable OSC 8 hyperlink.
This is the foundational UX that makes compact rendering work — users don't need content
previews because they can click to open the file instantly.

**Implementation**:
- New helper: `pkg/toolrender/hyperlink.go` → `FileHyperlink(displayPath, absolutePath) string`
- Generates OSC 8 escape sequence: `\033]8;;file://<absolutePath>\033\\<displayPath>\033]8;;\033\\`
- If `absolutePath` is relative, resolve against working directory from execution context
- Graceful degradation: when `TERM=dumb` or `NO_COLOR` is set, return plain `displayPath`
- All `RenderCompact` calls for file-related tools (Read, Write, Edit, Delete) wrap the
  path in `FileHyperlink()`

**Result**: `● Read(path/to/file.go)` where `path/to/file.go` is a clickable link that
opens the file in the user's editor/viewer.

**Files**: new `pkg/toolrender/hyperlink.go`, integrated into `render.go`
**Tests**: `hyperlink_test.go` — test OSC 8 output, graceful degradation

### 2.1 Read Tool — One-Line Compact

**Current** (3 lines + gutter):
```
📖 Read  path/to/file.go  (125 lines)  ✓
     │ package main
     │ import "fmt"
     │ func main() {
     ⋮ 122 more lines
```

**Target** (2 lines, clickable path, no content):
```
● Read(path/to/file.go)          ← path is a clickable hyperlink
    Read 125 lines
```

**Rationale**: Reads are reconnaissance. The user doesn't need to see *what* was read —
they care that it happened and how much data was consumed. The clickable path lets them
open the file with one click if they want to see the content. Claude Code proves this works.

**Implementation**:
- Add a new render mode to `toolrender`: `RenderCompact(tc ToolCallInfo) string`
- For read tools: `● Read(FileHyperlink(primaryField))` + newline + `    Read N lines`
- Line count from `tc.Result` via existing `countLines()` helper
- Path wrapped in OSC 8 hyperlink via `FileHyperlink()` (from Phase 2.0)
- No gutter, no syntax highlighting, no content preview
- Use in `run_stream_inline.go` instead of `RenderWithBadge`

**Grouping** (included): When 3+ sequential read events arrive, collapse into a
single grouped display:
```
● Read 6 files
    README.md, stigmer.yaml, planton.yaml, ...       (ctrl+e to expand)
```

On expand (ctrl+e), show individual reads:
```
● Read 6 files
    README.md — 77 lines
    stigmer.yaml — 12 lines
    planton.yaml — 112 lines
    onboard-planton-mcp-server.sh — 125 lines
    generate-approval-policy.sh — 80 lines
    README.md — 83 lines
```

**Implementation**:
- Buffer read `ToolCompletedEvent`s in `inlineRenderer` state
- On next non-read event (or after a short delay), flush the buffer:
  - If 1-2 reads: render individually as compact one-liners
  - If 3+ reads: render as grouped collapsed line
- "ctrl+e to expand" requires tracking collapsed groups and handling the keypress
  in the inline event loop. If ctrl+e handling adds too much complexity, fall back
  to always showing individual file names (one per line, ultra-compact):
  ```
  ● Read 6 files
      README.md — 77 lines
      stigmer.yaml — 12 lines
      planton.yaml — 112 lines
      onboard-planton-mcp-server.sh — 125 lines
      generate-approval-policy.sh — 80 lines
      README.md — 83 lines
  ```
  This is still far more compact than 6 × 5-line gutter-bordered blocks.

### 2.2 Write/Edit Tool — Compact with Content Preview

**Current** (3 lines + gutter):
```
📝 Write  path/to/file.go  ✓
     │ package main
     │ import "fmt"
     │ func main() {
     ⋮ 122 more lines
```

**Target** (decided: Option A — minimal with clickable path):
```
● Write(path/to/file.go)        ← path is a clickable hyperlink
    Wrote 125 lines
```

The clickable path lets users open the file with one click to verify what was
written. Content is always one click away — no need to dump it into the terminal.
If users later request more inline visibility, Option B (short preview) or
Option C (truncated content) can be added as `--verbose` behavior.

### 2.3 Shell Tool — Command + Exit Code + Truncated Output

**Current** (3 lines + gutter):
```
🖥 Shell  go test ./...  ✓
     │ ok  pkg/foo  0.5s
     │ ok  pkg/bar  1.2s
     │ FAIL pkg/baz 0.3s
     ⋮ 15 more lines
```

**Target**:
```
● Shell(go test ./...)  exit 0
    ok  pkg/foo  0.5s
    ok  pkg/bar  1.2s
    ok  pkg/baz  0.3s
    ... +15 more lines
```

**Changes**:
- Show exit code inline with the header (extracted from result metadata if available)
- Show up to 3-5 lines of output (configurable)
- Truncate with `... +N more lines` (no gutter border)
- Remove gutter `│` — use simple indentation (4 spaces)

### 2.4 Other Tools — Discovery, Search, Delete, Think

| Tool | Compact Format |
|------|---------------|
| Glob/Grep/Search | `● Search(pattern)` + `  Found N matches` |
| List directory | `● List(path/)` + `  N items` |
| Delete | `● Delete(path/to/file.go)` + `  Deleted` |
| Think | `● Think` + indented thought text (3 lines max) |
| Task (sub-agent) | See Phase 2.5 |

### 2.5 Sub-Agent Tool Grouping

**Current inline**:
```
🔀 Sub-agent started: Explore CLI rendering
● Read(file1.go)  ...
● Read(file2.go)  ...
● Shell(go test)  ...
🔀 Sub-agent abc123 ✓ (3 tools)
```

All tool calls are flat — no visual grouping.

**Target**:
```
● Task: Explore CLI rendering
  │ Read(file1.go) — Read 45 lines
  │ Read(file2.go) — Read 120 lines
  │ Shell(go test) — exit 0
  ✓ Done (3 tools)
```

**Implementation**:
- Track active sub-agent ID in `inlineRenderer` state
- When a tool event has `subAgentID != ""`, indent output with `  │ ` prefix
- Sub-agent header: `● Task: <description>` (same as Claude Code's Task tool)
- Sub-agent footer: `  ✓ Done (N tools)` or `  ✗ Failed (N tools)`
- Tool calls within sub-agent use ultra-compact format: `  │ Read(file) — N lines`
  (single line, no newline for result summary)

**Nesting**: For sub-agents within sub-agents (if supported), add another level of
indentation. Current backend metadata (`subAgentID`, `subAgentName`) is sufficient.

---

## Phase 3: Claude Code-Style Approval Flow

**Effort**: Medium (3-4 sessions)

**Reference**: Claude Code screenshots (2026-03-04) showing three visual states:
expanded content during approval wait, arrow-key decision menu, and in-place
collapse after decision using terminal cursor control.

This replaces the original plan's lightweight single-key prompt with a
significantly richer experience modeled after Claude Code's approval UX.

### 3.0 Terminal Cursor Control Primitives

The collapse-after-decision flow requires ANSI cursor control to erase the
expanded content and replace it with a compact summary. This is the foundation
that also enables Phase 4's thinking spinner.

New package: `pkg/termctl/`

| Function | Purpose |
|----------|---------|
| `MoveUp(w, n)` | ANSI `\033[nA` — move cursor up n lines |
| `ClearDown(w)` | ANSI `\033[J` — clear from cursor to end of screen |
| `ClearLine(w)` | ANSI `\033[2K\r` — clear current line |
| `TerminalWidth(fd)` | Terminal width via `golang.org/x/term` (already a dep) |
| `DisplayRows(text, width)` | Count actual display rows accounting for wrapping |
| `IsSupported(w)` | True if TTY + not dumb + not NO_COLOR |

**Graceful degradation**: When `IsSupported` returns false (pipe, dumb terminal,
CI), cursor control is skipped — content stays in scrollback as-is.

**Files**: new `pkg/termctl/termctl.go`, `termctl_test.go`, `BUILD.bazel`

### 3.1 Custom Inline Prompter

**Current**: `InteractivePrompter` uses Bubbletea `tea.NewProgram` for an
inline ↑↓ menu. This works but Bubbletea's opaque rendering prevents accurate
line counting needed for cursor-controlled collapse.

**Target**: New `InlinePrompter` using raw terminal mode for precise control.

```
Do you want to create tests/test_tools.sh?
> 1. Yes — Execute this tool
  2. Skip — Skip, continue execution
  3. Reject — Stop execution

Esc to cancel
```

**Design**:
- Arrow-key navigation (↑↓) + Enter to confirm (primary interaction)
- Number keys (1/2/3) as immediate accelerators for power users
- Esc and Ctrl+C for cancel
- Uses `term.MakeRaw` / `term.Restore` for single-character reads
- Reports **exact line count** of rendered output for cursor control
- Implements `Prompter` interface (compatibility) plus a richer
  `PromptInline(ctx, opts) (*Decision, lineCount, err)` for cursor integration

**Architecture**: `InteractivePrompter` (Bubbletea) retained for TUI mode.
`InlinePrompter` is for inline mode only. `Prompter` interface unchanged.

**Files**: new `pkg/approval/inline_prompter.go`, `inline_prompter_test.go`

### 3.2 Four-State Tool Rendering for Approval

Every tool requiring approval goes through four visual states. Content streams
in live during the running phase, then the approval prompt appears, then
everything collapses after the user decides.

**Background: Existing streaming infrastructure**

The backend already supports live tool content streaming:
- `ToolStreamDeltaEvent` fires when a running tool has `is_streaming=true`
- `tc.Result` accumulates content as the AI generates it (token by token)
- The TUI handles this via `renderStreamingTool()` (updates block in-place)
- **Inline mode currently SUPPRESSES all `ToolStreamDeltaEvent`s** (Phase 2
  decision). Phase 3 re-enables them for tools requiring approval.

**State 1: RUNNING + STREAMING (content generating)**

The tool enters `running` with `is_streaming=true`. `ToolStreamDeltaEvent`s
arrive with incremental content. Inline mode renders this by appending only
new bytes (same pattern as `renderAIStreamDelta` with `streamedBytes` tracking):

```
● Write(tests/test_tools.sh) …
────────────────────────
#!/usr/bin/env bash
# tests/test_tools.sh
# ================================================================
# ... (content appears progressively as AI generates it) ...
█                                          ← cursor blinks here
```

This is the "typewriter" live experience. The tool header shows the running
indicator (`…`), and the content streams in below it in real time.

**State 2: WAITING_APPROVAL (content complete, prompt shown)**

When the tool transitions from `running` to `waiting_approval`, streaming ends.
A separator and approval menu appear below the now-complete content:

```
● Write(tests/test_tools.sh)
────────────────────────
#!/usr/bin/env bash
# ... (full file content, now complete) ...
echo "done"

────────────────────────
Do you want to create tests/test_tools.sh?
> 1. Yes   2. Skip   3. Reject
Esc to cancel
```

**State 3: COLLAPSED (after decision)**

Cursor control erases ALL of states 1+2 (header + content + prompt), replaces
with compact summary:

Approved (green dot):
```
● Write(tests/test_tools.sh)
└ Wrote 241 lines to tests/test_tools.sh
    #!/usr/bin/env bash
    # ================================================================
    # tests/test_tools.sh
    ... (first ~10 lines of content preview)
    … +231 lines
```

Rejected (red dot):
```
● Write(tests/test_tools.sh)
└ User rejected write to tests/test_tools.sh
    #!/usr/bin/env bash
    ... (first ~10 lines)
    … +247 lines
```

Skipped (dim dot):
```
● Write(tests/test_tools.sh)
└ Skipped
```

**State 4: EXPANDED (ctrl+O)** — Deferred. The collapsed view is final for now.

**Streaming implementation in inline mode**:

Track streaming state per tool in `inlineRenderer`:
```
activeStreamID    string  // tool call ID of the tool currently streaming
streamedBytes     int     // bytes already printed (for delta rendering)
streamLineCount   int     // total lines printed for cursor control
```

When `ToolStreamDeltaEvent` arrives for a tool requiring approval:
- Print only new bytes: `e.Content[r.streamedBytes:]` (append-only, like AI streaming)
- Track `streamedBytes` and `streamLineCount` for each line printed
- No cursor control needed during streaming — content flows naturally

When `ToolWaitingApprovalEvent` arrives for the streaming tool:
- Finalize streaming state
- Add separator + approval menu (tracked in `streamLineCount`)
- Now cursor control can erase `streamLineCount` lines after decision

**New render functions** in `pkg/toolrender/render_compact.go`:
- `RenderApprovalResult(tc, action, opts) string` — collapsed view with `└` connector,
  content preview (~10 lines), truncation footer

### 3.3 Rewrite Event Handling in Inline Renderer

Significant changes to `run_stream_inline.go` to support the four-state flow:

**New pre-switch interceptions**:
1. **`ToolRunningEvent` for streaming tools**: When a running tool has
   `is_streaming=true`, print the tool header + separator. Initialize streaming
   state (`activeStreamID`, `streamedBytes = 0`, `streamLineCount`). Don't suppress.
2. **`ToolStreamDeltaEvent` for approval-bound tools**: Instead of suppressing
   (Phase 2 behavior), print incremental content: `e.Content[streamedBytes:]`.
   Track `streamedBytes` and `streamLineCount` for cursor control.
3. **`ToolWaitingApprovalEvent`**: When the streaming tool transitions to
   `waiting_approval`, finalize streaming. Add to `streamLineCount`.
4. **`ApprovalNeededEvent`**: Print separator + approval menu below streamed
   content. Total line count = `streamLineCount` + menu lines.

**handleApproval rewrite**:
1. **Prompt**: Create `InlinePrompter`, show menu, get decision + menu line count
2. **Collapse**: `termctl.MoveUp(totalLines)` + `termctl.ClearDown()` to erase
   everything (header + streamed content + separator + menu), then print
   `RenderApprovalResult` in place
3. **Suppress**: Track tool call IDs in `approvedToolIDs` set. Suppress
   subsequent `ToolCompletedEvent` for write/edit (result is deterministic).
   Let shell `ToolCompletedEvent` through.
4. **Reset**: Clear streaming state (`activeStreamID = ""`, `streamedBytes = 0`)
5. **Fallback**: If `termctl.IsSupported` is false, skip cursor control — print
   collapsed result below the expanded content.

**New fields on `inlineRenderer`**:
```
activeStreamID   string           // tool call ID currently streaming
streamedBytes    int              // bytes printed so far (for delta)
streamLineCount  int              // total lines for cursor control
approvedToolIDs  map[string]bool  // suppress duplicate ToolCompletedEvent
```

**For tools WITHOUT streaming** (no `is_streaming` flag but still require
approval): The `ApprovalNeededEvent` handler extracts content from `ArgsPreview`,
prints it all at once (as if all deltas arrived instantly), then shows the
approval menu. Same collapse flow applies.

### 3.4 Shell Tool Approval Variant

Shell approval shows the command:
```
● Shell(rm -rf ./tmp)
────────────────────────
Command: rm -rf ./tmp
────────────────────────
Do you want to execute this command?
> 1. Yes   2. Skip   3. Reject
```

After approval, shell output streams live via `ToolStreamDeltaEvent` (now
enabled for inline mode). On completion, collapses to compact shell format.

### Streaming Content Notes

The backend already provides live tool content streaming via `ToolStreamDeltaEvent`
(when `is_streaming=true` on the tool call). This was used by the TUI's
`renderStreamingTool()` function. Inline mode suppressed it in Phase 2.
Phase 3 re-enables it for tools requiring approval.

| Tool Type | Running phase | Waiting-approval phase | Post-approval |
|-----------|---------------|------------------------|---------------|
| Write/Edit | `ToolStreamDeltaEvent` streams file content as AI generates it | Content complete in args; show approval menu | Collapse to compact |
| Shell | `ToolStreamDeltaEvent` streams command (if backend supports) | Show command + approval menu | Output streams live via `ToolStreamDeltaEvent` |
| Other | May or may not stream | Args available at event time | Normal completion |

**Key lifecycle**: `ToolRunningEvent` (is_streaming) → multiple `ToolStreamDeltaEvent`s
→ `ToolWaitingApprovalEvent` → `ApprovalNeededEvent` → user decides → collapse.

**Inline streaming pattern**: Same as `renderAIStreamDelta` — track `streamedBytes`,
print only `e.Content[streamedBytes:]` on each delta. Append-only, no cursor control
needed during streaming. Cursor control only used for the final collapse after decision.

---

## Phase 4: Inline Follow-Up Input

**Effort**: Medium (1-2 sessions)

### 4.1 Post-Completion Readline

After the agent completes (or stops for follow-up), show a simple prompt:

```
● Agent completed. 4 tools used, 2 files modified.

> _
```

User types a follow-up message and presses Enter. The inline renderer sends it
as a follow-up and continues rendering events.

**Implementation** (decided: readline library with history/editing):
- After `DoneEvent` with `FollowUpFn != nil`, enter a readline loop
- Use `github.com/chzyer/readline` (or equivalent lightweight readline library) for:
  - Arrow key cursor movement within the line (Left/Right)
  - History recall via Up/Down arrows (previous follow-up messages)
  - Standard editing shortcuts (Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+W)
- On Enter: call `FollowUpFn` with the input, continue consuming events
- On Ctrl+C or empty input: exit
- On Ctrl+D (EOF): exit
- The prompt behaves like a proper shell prompt — not a dumb text box

### 4.2 Mid-Run Thinking Spinner (included)

When the agent is "thinking" between tool calls, there's a silent gap where nothing
appears on screen. Without any indicator, users can't tell if the agent is working
or frozen. The thinking spinner fills this gap:

```
● Read(main.go)
    Read 45 lines
● Read(utils.go)
    Read 120 lines
⠋ Thinking...                              [Esc to cancel]
```

The spinner animates in-place on stderr using `\r` (carriage return) to overwrite
itself. The moment new output arrives (tool call, AI content, etc.), the spinner
line is cleared and replaced by the real content. It never pollutes scrollback —
it's purely ephemeral.

**Implementation**:
- Reuse the existing `pkg/spinner` package (already used for preparation phase)
- Start spinner after `PhaseChangeEvent` to `in_progress` when no tool is running
- Stop spinner on next `ToolRunningEvent`, `AIStreamStartEvent`, or `DoneEvent`
- Spinner writes to stderr (consistent with Phase 2.4's preparation spinner)
- Show `[Esc to cancel]` hint alongside the spinner text
- Esc handling: detect Esc keypress in raw mode and trigger cancel flow

---

## Phase 5: Quick Cleanups (from UX Hardening Plan)

**Effort**: Small (< 1 hour)

These are bug fixes and dead code removal from the previous plan that should be
done regardless:

| Item | Description | Files |
|------|-------------|-------|
| 3.7 | Follow-up todo block index reset | `pkg/executiontui/followup.go` |
| 3.8 | Duplicate `resolveOrgID` call | `run_resolve.go` |
| 3.9 | Orphaned pre-TUI approval functions | `run_stream_approval.go` |

---

## Implementation Order

```
Phase 1: Flip Default (small)              ←── DONE (Session 1)
  1.1 Change resolveOutputMode default
  1.1 Add --tui flag, deprecate --no-tui

Phase 2: Compact Tool Rendering (core)     ←── DONE (Sessions 2-8)
  2.0 Clickable file paths (OSC 8 hyperlinks)
  2.1 Read → one-line compact with clickable path
  2.1b Read → consecutive-event grouping
  2.2 Write/Edit → compact with clickable path
  2.3 Shell → command + truncated output
  2.4 Other tools (glob, search, delete, think)
  2.5 Sub-agent grouping with indentation

Phase 3: Claude Code-Style Approval Flow   ←── NEXT
  3.0 Terminal cursor control primitives (pkg/termctl)
  3.1 Custom inline prompter (arrow-key menu, raw mode)
  3.2 Three-state tool rendering (expanded → collapse)
  3.3 Rewrite handleApproval (orchestrate expand/prompt/collapse)
  3.4 Shell tool approval variant + streaming output

Phase 4: Inline Follow-Up + Thinking Spinner
  4.1 Post-completion readline loop (with history/editing)
  4.2 Mid-run thinking spinner (uses termctl from Phase 3.0)

Phase 5: Quick Cleanups
  5.1 Todo index reset, duplicate code, orphaned functions
```

## Success Criteria

1. `stigmer run agent x` on TTY → inline mode (no alt-screen) by default
2. `stigmer run agent x --tui` → alt-screen TUI (opt-in)
3. Read tools render as `● Read(path)` + `Read N lines` with clickable path (2 lines total)
4. Write tools render as compact header + line count with clickable path
5. Shell tools show command + truncated output
6. All file paths in tool rendering are OSC 8 clickable hyperlinks (graceful degradation)
7. Sub-agent tool calls grouped under header with `│` indentation
8. Write/edit tools stream content live during running phase (typewriter effect via `ToolStreamDeltaEvent`)
9. Approval menu appears below streamed content when tool enters `waiting_approval`
10. After decision: cursor-collapses entire block (header + content + menu) to compact summary
11. Approved tools show `└` connector with result summary + ~10 line content preview
12. Rejected tools show `└ User rejected` with content preview
13. Shell tool output streams live after approval via `ToolStreamDeltaEvent`
12. Graceful degradation: non-TTY/dumb terminals skip cursor control (content stays)
13. Follow-up input works after completion via readline with history/editing
14. Mid-run thinking spinner shows during agent "thinking" gaps
15. Sequential reads (3+) grouped into compact collapsed display
16. All existing tests pass (TUI mode unchanged, inline rendering updated)
17. `stigmer run agent x --json | jq` still works (unchanged)

## Design Decisions (Finalized)

All design decisions were reviewed and approved on 2026-03-04:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Write/Edit rendering (non-approval) | **Option A** (minimal: header + line count) | Clickable path provides one-click access to content |
| Read grouping | **Yes** (collapse 3+ sequential reads) | Reduces noise; grouped display with individual file listing |
| Follow-up readline | **With history/editing** (`chzyer/readline`) | Shell-like UX for multi-turn conversations |
| Mid-run thinking spinner | **Yes** (include in MVP) | Eliminates "is it frozen?" anxiety during thinking gaps |

Approved on 2026-03-04, Session 9 (Phase 3 redesign):

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approval interaction model | **Arrow-key menu** (not single-key) | Safety-first: two deliberate actions (navigate + enter) prevent accidental approvals |
| Approval labels | **Yes / Skip / Reject** | "Yes" is natural; "Reject" is unambiguous (means stop everything); "Skip" is the middle ground |
| Inline prompter | **Custom raw-mode** (replace Bubbletea for inline) | Cursor control integration requires exact line counting; Bubbletea rendering is opaque |
| Post-decision collapse | **Cursor control erase + replace** | Claude Code reference UX; requires ANSI cursor primitives |
| `└` connector style | **Yes** (tree-drawing for collapsed result) | Matches Claude Code's visual hierarchy; shows parent-child relationship |
| Ctrl+O expand | **Deferred** | Ship collapsed view first; expand feature adds complexity |
| "Yes, approve all" option | **Deferred** | Infrastructure exists (`defaultAction`); ship core 3 options first |
| Tool content streaming | **Re-enable `ToolStreamDeltaEvent` for approval tools** | Live typewriter effect during running phase; append-only like AI streaming; currently suppressed in inline mode |
| Shell output streaming | **Enable `ToolStreamDeltaEvent` post-approval** | Real-time shell output after approval; same append-only pattern |

## Estimated Effort

| Phase | Scope | Estimated Effort | Status |
|-------|-------|-----------------|--------|
| Phase 1 | Output mode flip | < 1 hour | DONE |
| Phase 2 | Tool rendering (8 items incl. hyperlinks + grouping) | 7 sessions | DONE |
| Phase 3 | Claude Code-style approval flow (5 items) | 3-4 sessions | NEXT |
| Phase 4 | Follow-up input + thinking spinner | 1-2 sessions | Pending |
| Phase 5 | Quick cleanups | < 1 hour | Pending |
| **Total** | | **12-14 sessions** | |

---

**APPROVED** — Phase 3 redesigned on 2026-03-04. Ready for execution.
