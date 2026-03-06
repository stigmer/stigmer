# Task T01: Architecture Design and Migration Plan

**Created**: 2026-03-05
**Status**: REVISED -- Phase 1 implemented with conservative approach (see note below)
**Type**: Refactoring

> **IMPORTANT -- Plan Divergence Notice (2026-03-05)**
>
> During Phase 1 implementation, three API-level constraints in Bubbletea v1.2.4
> invalidated key assumptions in this plan. A conservative integration strategy
> was adopted instead of the "single writer / all output through tea.Println()"
> approach described below. The phase descriptions remain directionally correct
> as goals but are no longer literal implementation specs.
>
> **What changed:**
> - Bubbletea owns stderr only (not a single writer) -- AI content stays on stdout
> - `tea.WithInput(nil)` -- Bubbletea does not own stdin
> - Existing `for { select {} }` event loop retained (not migrated to tea.Update)
> - `inApprovalFlow` sentinel gates approval writes as direct (not through Println)
>
> **Full details:**
> - Design decision: `design-decisions/001-conservative-bubbletea-integration.md`
> - Wrong assumption: `wrong-assumptions/001-single-writer-all-through-println.md`
> - Session checkpoint: `checkpoints/2026-03-05-session-1.md`

## Objective

Replace all manual ANSI cursor math in the Stigmer CLI inline renderer with Bubbletea's inline mode (no alt screen). Bubbletea manages row tracking and cursor movement internally, eliminating the fragile `lineCountingWriter` that only counts `\n` bytes and drifts when terminal soft-wrapping occurs.

## Why Bubbletea Inline Mode

Claude Code uses Ink (React for terminals) which works identically to Bubbletea inline mode:
- Render the current view as a string
- Framework measures the display height (ANSI-aware, accounts for terminal wrapping)
- On re-render: cursor-up by the measured height, clear, write fresh content
- No manual line counting, no raw ANSI escape sequences

Bubbletea is already in `go.mod`. It already runs inline (no alt screen) by default -- `tea.WithAltScreen()` is opt-in. The interactive approval prompter already uses Bubbletea (`pkg/approval/interactive.go`).

## Current Architecture (What We're Replacing)

### Rendering flow today

```
gRPC stream
    |
    v
streamToEvents()          -- goroutine: converts gRPC updates to TUI events
    |
    v
chan executiontui.Event    -- buffered channel
    |
    v
renderInline()            -- event loop: dispatches to render methods
    |
    +--> r.statusf()      -- writes to cfg.status (wrapped stderr)
    +--> fmt.Fprintf(data) -- writes to cfg.data (wrapped stdout)
    +--> termctl.EraseLines()  -- ANSI cursor-up + clear
    +--> raw \033[...] sequences (subject updater)
```

### Files with manual cursor control (total ~1500 lines of rendering logic)

| File | Cursor mechanism | Purpose |
|------|-----------------|---------|
| `run_stream_inline_header_update.go` | `\033[s`, `\033[NA`, `\033[2K`, `\033[u` | Subject in-place replacement |
| `run_stream_inline_approval.go` | `termctl.EraseLines` (6 calls) | Approval collapse after user decision |
| `run_stream_inline_streaming.go` | `termctl.EraseLines` (2 calls) | Pre-approval tool content erasure |
| `run_stream_inline_followup.go` | `termctl.EraseLines` (1 call) | Follow-up prompt erasure |
| `pkg/approval/inline_prompter.go` | `termctl.EraseLines` (1 call) | Menu re-render during approval |
| `pkg/spinner/spinner.go` | `\r\033[K` | Thinking spinner line overwrite |

### The fundamental bug

`lineCountingWriter` counts `\n` bytes. ANSI `\033[NA` moves by display rows. When any line exceeds terminal width, the terminal soft-wraps it (new display row, no `\n`). The counter drifts. Every cursor-back operation using this counter hits the wrong row.

## Target Architecture (Bubbletea Inline Mode)

### Key design decisions

1. **Single writer**: All inline output goes through one Bubbletea program. No stdout/stderr split in inline mode. The `--json` flag (separate code path) handles scripting/CI.

2. **Two render regions**:
   - **Committed output**: Content that has been "committed" to the terminal scrollback (completed AI messages, completed tool results, past human messages). Written via `tea.Println()` -- Bubbletea prints it above the active view and adjusts its internal row tracking.
   - **Active view**: The dynamic portion managed by `View()` (header panel, thinking spinner, current tool streaming, approval prompt, follow-up input). This is what Bubbletea re-renders in place.

3. **Preserve ALL UX**: The visual output is identical. The `View()` function uses the same lipgloss styles, same `toolrender.RenderCompact()`, same `panel.Render()`, same `humanMsgStyle`, etc. Only the plumbing changes (who manages the cursor).

### Rendering flow after migration

```
gRPC stream
    |
    v
streamToEvents()              -- unchanged
    |
    v
chan executiontui.Event        -- unchanged
    |
    v
tea.Program (inline mode)     -- Bubbletea event loop
    |
    +--> Update(msg)           -- state transitions (same logic as handleEvent today)
    |     returns tea.Cmd      -- e.g., tea.Println() for committed output
    |
    +--> View() string         -- renders ONLY the active region
          |                       (header, spinner, approval, streaming tool)
          |
          Bubbletea measures display rows, handles cursor-up/clear automatically
```

### What `tea.Println()` does

Bubbletea's `tea.Println(lines...)` writes content ABOVE the active view:
- It cursor-ups past the current view
- Writes the permanent line
- Cursor-downs back to the active view position
- Re-renders the active view below

This is perfect for "committing" completed output (AI messages, tool results) while keeping the dynamic view (spinner, approval) at the bottom.

## UX Elements to Preserve (Checklist)

Every visual element currently rendered must look identical after migration:

### Session Header
- [ ] Bordered panel with "Stigmer" title (`panel.Render`)
- [ ] Agent, Session, Subject (placeholder then in-place update), Model, Workspaces fields
- [ ] Subject updates in-place when backend provides it (now via View() re-render, not ANSI cursor-back)
- [ ] Spacing between header and first message

### Human Messages
- [ ] Dark gray background with white text (`humanMsgStyle`)
- [ ] `\n\n` spacing after each message

### AI Content
- [ ] Markdown rendered with ANSI styling (`mdrender.Render`)
- [ ] `"● "` prefix for root agent messages
- [ ] Gutter-wrapped for sub-agent messages

### Tool Calls
- [ ] Compact one-line format: `⊡ tool_name key=value` (`toolrender.RenderCompact`)
- [ ] File path hyperlinks (`toolrender.CompactOptions.HyperlinksEnabled`)
- [ ] Read grouping: consecutive reads collapsed into `⊡ 5 files read`
- [ ] Running indicators suppressed (append-only model)

### Approval Flow
- [ ] Separator line before approval panel
- [ ] Expanded approval header with tool details
- [ ] Pre-approval content streaming (typewriter effect for write/edit)
- [ ] Interactive menu (approve/skip/reject) with keyboard navigation
- [ ] Collapse after decision: erase expanded view, show compact one-liner
- [ ] `suppressedToolIDs` for write/edit/delete completions after approval

### Thinking Spinner
- [ ] Braille-dot animation (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) with elapsed time
- [ ] Starts after idle delay, clears before next event
- [ ] Single-line overwrite (no scrolling)

### Follow-up Prompt
- [ ] Separator + hint + `>` prompt after execution completes
- [ ] Erase prompt after user submits, show styled message
- [ ] `suppressHumanEcho` to prevent duplicate display

### Sub-agent Rendering
- [ ] `▸ agent-name description` start badge
- [ ] Gutter-wrapped tool calls and AI messages
- [ ] `✓ agent-name (N tools)` completion badge

### Todo/Plan Updates
- [ ] `Plan:` header with `[x]`/`[-]`/`[ ]` markers

### Phase Changes
- [ ] Only "failed" and "cancelled" print status text in inline mode

## Migration Strategy (Incremental)

### Phase 1: Foundation -- Bubbletea Model Shell

Create the `tea.Model` struct and event loop that wraps the existing rendering. At this stage, `View()` returns empty string and all output goes through `tea.Println()` (committed immediately). This is a behavioral no-op -- output looks the same but flows through Bubbletea.

**Files created/modified:**
- New: `run_stream_inline_bubbletea.go` -- `tea.Model`, `Init`, `Update`, `View`
- Modified: `run_stream.go` -- wire `tea.Program` instead of direct `renderInline`
- Modified: `run_stream_inline.go` -- convert `handleEvent` to produce `tea.Cmd`

**Checkpoint**: All existing tests pass. Visual output identical.

### Phase 2: Active View -- Thinking Spinner

Move the thinking spinner from manual `\r\033[K` overwrite to the `View()` function. When thinking, `View()` returns the spinner line. When not thinking, `View()` returns empty.

**Files modified:**
- `run_stream_inline_bubbletea.go` -- spinner state in Model, View renders it
- Delete: spinner usage in `run_stream_inline_spinner.go` (or simplify to state-only)

**Checkpoint**: Spinner renders via Bubbletea. No manual `\r\033[K`.

### Phase 3: Active View -- Session Header with Subject

Move the session header panel into the initial `View()`. The Subject field reads from Model state. When `pollSessionSubject` gets the subject, it sends a `tea.Msg`. `Update` sets the subject, `View` re-renders the header. Bubbletea handles the cursor movement.

**Files modified/deleted:**
- `run_stream_inline_bubbletea.go` -- header in View, subject update via Msg
- Delete: `run_stream_inline_header_update.go` (lineCountingWriter, subjectUpdater, pollSessionSubject as ANSI cursor code)
- Keep: `run_stream_inline_header.go` (formatSessionHeaderContent, formatHeaderRow -- reused by View)

**Checkpoint**: Subject updates correctly. `lineCountingWriter` deleted.

### Phase 4: Active View -- Approval Flow

Move the approval panel (expanded view + interactive menu + collapse) into the active view. When waiting for approval, `View()` renders the separator + expanded header + content + menu. After user decides, `Update` transitions state and the next `View()` shows the collapsed result.

**Files modified:**
- `run_stream_inline_bubbletea.go` -- approval state in Model, View renders panel
- Simplify: `run_stream_inline_approval.go` -- keep logic, remove all `termctl.EraseLines`
- Simplify: `pkg/approval/inline_prompter.go` -- remove `termctl.EraseLines` in rerenderMenu

**Checkpoint**: Approval collapse works via View re-render. No EraseLines.

### Phase 5: Active View -- Tool Streaming

Move pre-approval tool content streaming (typewriter effect for write/edit) into the active view. `View()` renders the streaming content. On completion, `Update` transitions to the approval state.

**Files modified:**
- `run_stream_inline_bubbletea.go` -- streaming state, View renders content
- Simplify: `run_stream_inline_streaming.go` -- remove EraseLines, keep content logic

**Checkpoint**: Streaming tool content appears and is replaced by approval panel.

### Phase 6: Active View -- Follow-up Prompt

Move the follow-up prompt (separator + hint + `>` input) into the active view. After execution completes, `View()` renders the prompt. On submit, `Update` erases (via View returning empty) and commits the styled message.

**Files modified:**
- `run_stream_inline_bubbletea.go` -- follow-up state, View renders prompt
- Simplify: `run_stream_inline_followup.go` -- remove EraseLines

**Checkpoint**: Follow-up prompt works without EraseLines.

### Phase 7: Cleanup

- Delete `lineCountingWriter` and `subjectUpdater`
- Remove all `termctl.EraseLines` calls from inline renderer
- Audit: no raw ANSI cursor sequences remain in inline rendering path
- Update all tests
- `termctl.EraseLines` may remain for non-inline paths if any

## Testing Strategy

1. **Characterization tests first**: Before any migration, capture the exact output of each rendering path (human message, tool compact, approval collapse, etc.) as golden files. These become regression tests.

2. **Per-phase verification**: Each migration phase has a checkpoint where all existing tests must pass and visual output must be identical.

3. **Terminal wrapping test**: New test that writes content wider than terminal width, then triggers an in-place update (subject, approval collapse). Verifies the update lands on the correct row -- the bug that motivated this rewrite.

4. **Manual smoke test checklist**: Before declaring done, run a real agent execution and verify every UX element visually.

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| UX regression (subtle visual differences) | Characterization tests capture exact output; per-phase visual verification |
| Bubbletea inline mode edge cases | Phase 1 is a no-op wrapper; if issues surface, we catch them early |
| tea.Println ordering with View | Bubbletea guarantees Println appears above View; test with rapid events |
| Follow-up input lifecycle | Bubbletea handles stdin natively; test TTY and non-TTY |
| Performance with long sessions | tea.Println commits content permanently; View only renders active region (small) |
| JSON mode regression | JSON mode is a separate code path; not touched by this migration |

## Files Inventory

### Will be significantly modified or replaced
- `run_stream_inline.go` (650 lines) -- core renderer becomes Bubbletea Update/View
- `run_stream_inline_approval.go` (300 lines) -- remove EraseLines, keep logic
- `run_stream_inline_streaming.go` (200 lines) -- remove EraseLines, keep logic
- `run_stream_inline_followup.go` (100 lines) -- remove EraseLines, keep logic
- `run_stream_inline_header_update.go` (180 lines) -- largely deleted
- `run_stream.go` -- wire tea.Program

### Will be simplified
- `pkg/approval/inline_prompter.go` -- remove EraseLines
- `pkg/spinner/spinner.go` -- may become state-only (no direct \r\033[K)

### Unchanged
- `run_stream_json.go` -- separate code path
- `run_stream_events.go` -- event production unchanged
- `run_stream_snapshot.go` -- snapshot event production unchanged
- `run_display.go` -- formatting functions reused by View
- `pkg/toolrender/` -- compact/expanded rendering reused by View
- `pkg/panel/` -- panel rendering reused by View
- `pkg/termctl/` -- may retain for Width/Height/DisplayRows utilities

### New
- `run_stream_inline_bubbletea.go` -- tea.Model, Init, Update, View

## Success Criteria

1. All in-place updates work correctly regardless of terminal width and wrapping
2. Zero UX regression -- every visual element identical to current rendering
3. `lineCountingWriter` and raw ANSI cursor sequences eliminated from inline renderer
4. `--json` mode unchanged
5. All existing tests pass (updated for new architecture)
6. New terminal-wrapping regression test added
