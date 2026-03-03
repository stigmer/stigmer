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
| Approval | Bubbletea ↑↓ menu (heavy) | Single-key `[a/s/r/Esc]` prompt |
| Follow-up | Not supported (exits on completion) | Simple readline prompt after completion |
| Multiple reads | Individual 3-line blocks | Grouped: `Read N files (ctrl+e to expand)` |

### Files in Scope

| Package | Key Files |
|---------|-----------|
| `cmd/stigmer/root/` | `output_mode.go`, `run_stream_inline.go`, `run_stream.go`, `run_session.go` |
| `pkg/toolrender/` | `render.go`, `file_preview.go` |
| `pkg/approval/` | `interactive.go`, `prompt_model.go` |

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
    README.md, stigmer.yaml, planton-cloud.yaml, ...       (ctrl+e to expand)
```

On expand (ctrl+e), show individual reads:
```
● Read 6 files
    README.md — 77 lines
    stigmer.yaml — 12 lines
    planton-cloud.yaml — 112 lines
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
      planton-cloud.yaml — 112 lines
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

## Phase 3: Streamlined Approval Prompts

**Effort**: Small-Medium (1 session)

### 3.1 Single-Key Inline Approval

**Current**: Full Bubbletea program with ↑↓ menu selection + Enter to confirm.
This is heavy for inline mode — launches a mini-TUI for each approval.

**Target**: Single-key prompt matching the TUI footer pattern:

```
⏸  Approval required: Shell(rm -rf ./tmp)
    Command: rm -rf ./tmp

  [a] Approve  [s] Skip  [r] Reject  [Esc] Cancel
  >
```

User presses `a` (single key, no Enter needed) → `→ Approved` appears and execution
continues.

**Implementation**:
- New `approval.InlinePrompter` (or modify `InteractivePrompter`)
- Use raw terminal mode for single-key read (via `term.MakeRaw` + single byte read)
- Restore terminal immediately after key press
- Keys: `a` = approve, `s` = skip, `r` = reject, `Esc` = cancel
- On `r` (reject): optionally prompt for a reason with a simple readline
- No Bubbletea dependency for this prompt

### 3.2 Approval Context Display

Show enough context for the user to decide:

| Tool Type | Context Shown |
|-----------|---------------|
| Shell | Full command |
| Write | Filepath + line count |
| Edit | Filepath + what's changing (old→new first line) |
| Delete | Filepath |
| Other | Tool name + args summary |

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
Phase 1: Flip Default (small)              ←── START HERE
  1.1 Change resolveOutputMode default
  1.1 Add --tui flag, deprecate --no-tui

Phase 2: Compact Tool Rendering (core)
  2.0 Clickable file paths (OSC 8 hyperlinks)
  2.1 Read → one-line compact with clickable path
  2.2 Write/Edit → compact with clickable path + preview decision
  2.3 Shell → command + exit code + truncated
  2.4 Other tools (glob, search, delete, think)
  2.5 Sub-agent grouping with indentation

Phase 3: Streamlined Approvals
  3.1 Single-key inline prompt (replace Bubbletea menu)
  3.2 Approval context display

Phase 4: Inline Follow-Up + Thinking Spinner
  4.1 Post-completion readline loop (with history/editing)
  4.2 Mid-run thinking spinner

Phase 5: Quick Cleanups
  5.1 Todo index reset, duplicate code, orphaned functions
```

## Success Criteria

1. `stigmer run agent x` on TTY → inline mode (no alt-screen) by default
2. `stigmer run agent x --tui` → alt-screen TUI (opt-in)
3. Read tools render as `● Read(path)` + `Read N lines` with clickable path (2 lines total)
4. Write tools render as compact header + line count with clickable path
5. Shell tools show command + exit code + truncated output
6. All file paths in tool rendering are OSC 8 clickable hyperlinks (graceful degradation)
6. Sub-agent tool calls grouped under header with `│` indentation
7. Approval prompts use single-key `[a/s/r/Esc]` (no Bubbletea menu)
8. Follow-up input works after completion via readline with history/editing
9. Mid-run thinking spinner shows during agent "thinking" gaps
10. Sequential reads (3+) grouped into compact collapsed display
11. All existing tests pass (TUI mode unchanged, inline rendering updated)
12. `stigmer run agent x --json | jq` still works (unchanged)

## Design Decisions (Finalized)

All design decisions were reviewed and approved on 2026-03-04:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Write/Edit rendering | **Option A** (minimal: header + line count) | Clickable path provides one-click access to content |
| Read grouping | **Yes** (collapse 3+ sequential reads) | Reduces noise; grouped display with individual file listing |
| Follow-up readline | **With history/editing** (`chzyer/readline`) | Shell-like UX for multi-turn conversations |
| Mid-run thinking spinner | **Yes** (include in MVP) | Eliminates "is it frozen?" anxiety during thinking gaps |

## Estimated Effort

| Phase | Scope | Estimated Effort |
|-------|-------|-----------------|
| Phase 1 | Output mode flip | < 1 hour |
| Phase 2 | Tool rendering (6 items incl. hyperlinks + grouping) | 2-3 sessions |
| Phase 3 | Approval prompts | 1 session |
| Phase 4 | Follow-up input + thinking spinner | 1-2 sessions |
| Phase 5 | Quick cleanups | < 1 hour |
| **Total** | | **5-7 sessions** |

---

**APPROVED** — All decisions finalized. Ready for execution.
