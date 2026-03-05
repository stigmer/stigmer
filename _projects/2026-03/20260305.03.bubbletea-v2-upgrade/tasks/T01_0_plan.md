# Task T01: Bubbletea v2 Migration + Design Decision Cleanup

**Created**: 2026-03-05 11:00
**Revised**: 2026-03-05 (post deep-research)
**Status**: PENDING REVIEW
**Type**: Migration

> **This plan requires your review before execution**

## Objective

Upgrade Bubbletea from v1.2.4 to v2.0.x across the Stigmer CLI, then leverage v2's native capabilities to resolve design compromises and deferred work from projects 01 (bubbletea-inline-renderer) and 02 (expand-collapse-tools). Additionally, fix the scrollback duplication problem in the re-commit mechanism based on deep research findings.

## Context

Two predecessor projects built the current TUI on Bubbletea v1:
- **20260305.01** (bubbletea-inline-renderer): Migrated all ANSI cursor math to Bubbletea v1 inline mode (7 phases, complete)
- **20260305.02** (expand-collapse-tools): Built event history, Ctrl+O toggle, follow-up prompt, Bubbletea stdin ownership (5 phases + post-fix, complete)

Bubbletea v2.0.0 shipped Feb 24, 2026 (v2.0.1 on Mar 2). It brings cursor positioning, declarative View, a new "Cursed Renderer", and better keyboard handling -- resolving multiple v1 constraints.

## Research Findings (Deep Research Report)

A deep research investigation into terminal rendering, Ink's architecture, and Bubbletea v2's Cursed Renderer produced critical findings that reshape this plan. Full report: `research.inline-rerender-without-scrollback-duplication/04.report.gpt.md`

### Key Finding: Scrollback Is Immutable

Once content enters terminal scrollback, no application can edit it. This is a fundamental terminal limitation -- not solvable by any escape sequence, scroll region, cursor bookmark, or alt-screen trick. Both Ink (`<Static>`) and Bubbletea (`tea.Println`) treat committed content as append-only and immutable.

### Key Finding: `\033[2J]` vs `\033[2J\033[3J]`

Our current re-commit uses `\033[2J` (Erase in Display) which clears the visible screen but **pushes content to scrollback** -- causing duplication. The fix is adding `\033[3J` (Erase Saved Lines) which clears scrollback too. Combined: `\033[2J\033[3J` wipes both screen and scrollback before replay. No duplication.

### Key Finding: Claude Code's Ctrl+O Behavior (User-Observed)

Claude Code handles expand/collapse by:
1. Clearing the **entire terminal including scrollback** (equivalent to `\033[2J\033[3J`)
2. Replaying the full session from the header in the toggled mode
3. **Hiding the follow-up input prompt** in expanded mode (expanded = "read mode")
4. Showing the follow-up input prompt only in collapsed mode (collapsed = "interact mode")

The trade-off: pre-session terminal history (previous shell commands) is cleared on toggle. This is an accepted pattern for AI CLI tools.

### Approaches Considered and Rejected

| Approach | Why Rejected |
|----------|-------------|
| **Mutable window** (keep everything in View, lazy commit) | Cursed Renderer drops top lines when View() exceeds terminal height -- dropped lines vanish entirely, not added to scrollback. Users lose terminal scrollback. |
| **All-in-View** (never commit, build in-app pager) | Same as above + requires custom scroll mechanism. Fundamentally changes the inline mode UX. |
| **Targeted line-erasure** (cursor-up + erase specific lines) | Only works for content still on visible screen. Once scrolled off, immutable. Doesn't solve the general case. |
| **DECSTBM scroll regions** | Inconsistent scrollback behavior across terminals (kitty, iTerm2, Terminal.app). High risk. |
| **Alt-screen as temporary redraw surface** | Scrollback interaction is configurable per-terminal and unreliable. |

### Chosen Approach: `\033[3J` + Replay (Claude Code Pattern)

The simplest and most proven approach. Keep the existing commit-based architecture (`tea.Println` for all content). On any re-render trigger (Ctrl+O, approval collapse, header update), clear screen + scrollback + replay from in-memory history. Zero duplication.

---

## v1 Design Compromises That v2 Resolves

### 1. No cursor positioning (CRITICAL -- prompted this project)

**v1 problem**: `View()` returns a `string`; the terminal cursor always lands at the end. Cannot position cursor on the input line when footer content exists below.

**v2 solution**: `View()` returns `tea.View` with `Cursor *tea.Cursor`:
```go
v.Cursor = &tea.Cursor{
    Position: tea.Position{X: col, Y: row},
    Shape:    tea.CursorBar,
    Blink:    true,
}
```
Solves the follow-up prompt UX (footer below input, cursor on input line).

### 2. Custom text input with no real cursor

**v1 problem**: `handleTextInputKey` (`run_stream_inline_keypress.go` L73-89) is a minimal rune buffer with only backspace. No cursor movement, word deletion, or input history. Listed as "Future: advanced text input" in project 02.

**v2 solution**: `bubbles/textinput` v2 has real cursor support via the `tea.Cursor` API. Replace the custom buffer and get cursor movement, word navigation, and rendering for free.

### 3. Ctrl+O during follow-up prompt (deferred)

**v1 problem**: Documented in `design-decisions/ctrl-o-during-follow-up-prompt.md` (project 02). Follow-up prompt blocks on `<-inputCh` while the event loop is not running, so Ctrl+O is buffered and applied only at the next execution start.

**v2 opportunity**: With `bubbles/textinput` v2 as a child model, text input runs INSIDE the `Update()` cycle. The event loop handles both text keys and Ctrl+O simultaneously. No more blocking outside the event loop.

### 4. Terminal resize re-commit (deferred)

**v1 problem**: Project 02 Phase 5 decision. Mode-invariant items store pre-rendered text at original width; resize would only reflow some items. "Proper resize support requires storing raw content for all items."

**v2 opportunity**: v2's Cursed Renderer (ncurses-based) may handle reflow better natively. Combined with the existing re-commit mechanism, worth re-evaluating.

### 5. Lipgloss I/O conflicts

**v1 problem**: Lipgloss and Bubbletea fought over terminal I/O (Lipgloss querying background color vs Bubbletea reading keyboard input).

**v2 solution**: Lipgloss v2 is "pure" -- Bubbletea manages all I/O. Eliminates subtle terminal corruption bugs.

### 6. Space bar handling inconsistency

**v1 problem**: `tea.KeySpace` is a separate key type requiring a special case to append `" "`.

**v2 solution**: Space returns `"space"` via `msg.String()`, handled uniformly. The separate `case tea.KeySpace:` is eliminated.

### 7. No paste support in follow-up

**v1 problem**: Paste arrives as rapid `tea.KeyMsg` events (individual runes).

**v2 solution**: `tea.PasteMsg` with `msg.Content` delivers the full pasted text atomically. Combined with `textinput.Model`, paste-to-input works correctly.

---

## v1 Design Decisions That Remain Valid in v2

These were correct architectural choices, NOT v1 limitations:

- **Stdout/stderr split** -- AI token streaming cannot go through `tea.Println` (still line-based in v2). The `dataW`/`statusW` split stays.
- **Header as committed content via Bubbletea** -- `View()` renders at the bottom in inline mode; unchanged in v2. Header remains committed.
- **Event history + re-commit for Ctrl+O** -- Fundamentally sound. v2 doesn't change the committed/active split. The re-commit mechanism is now upgraded with `\033[3J` to eliminate scrollback duplication.
- **Pre-render in renderer, not model** -- Good separation of concerns.
- **Channel-based decision delivery** -- Clean, type-safe. Stays.
- **Batch Println optimization** -- Single Println with pre-rendered string. Still valuable.

## v1 Limitations Now Resolved by Research Findings

These were problems caused by missing knowledge, not v1 API limitations:

- **Scrollback duplication on re-commit** -- Fixed by adding `\033[3J` (Erase Saved Lines) to the clear sequence. Re-commit is now safe to use for any purpose.
- **Session header subject update deferred** -- Was deferred because re-commit caused duplicate headers in scrollback. Now feasible: re-commit with `\033[3J` on subject resolution.
- **Follow-up prompt visible in expanded mode** -- Claude Code observation: hide the follow-up prompt in expanded (Ctrl+O) mode. Expanded = read mode, collapsed = interact mode.

---

## Migration Scope Inventory

### Files requiring changes (by category)

**Bubbletea imports (12 files)**:
- `run_stream_inline_bubbletea.go`, `run_stream_inline_keypress.go`, `run_stream_inline_followup.go`, `run_stream_inline_history.go`, `run_stream_inline_types.go`, `run_stream.go` (core TUI)
- `approval/interactive.go`, `approval/prompt_model.go` (approval flow)
- `cliprint/progress.go` (progress display)
- 3 test files (`_bubbletea_test.go`, `_keypress_test.go`, `prompt_model_test.go`)

**Lipgloss imports (12 files)**:
- `run_display.go`, `panel/panel.go`, `panel/panel_wrap.go`, `toolrender/render.go`, `toolrender/render_compact.go`, `toolrender/render_approval.go`, `approval/inline_prompter.go`, `approval/formatter.go`, `approval/prompt_model.go`, `cliprint/progress.go`, plus 2 test files

**Bubbles imports (2 files)**:
- `cliprint/progress.go` (spinner), `approval/prompt_model.go` (textinput)

**Key API changes to apply**:
| v1 API | v2 API | Locations |
|--------|--------|-----------|
| `tea.KeyMsg` | `tea.KeyPressMsg` | ~23 test + 5 handler |
| `View() string` | `View() tea.View` | 3 models |
| `msg.Type` / `msg.Runes` | `msg.Code` / `msg.Text` | keypress handlers + tests |
| `case tea.KeySpace:` | `case "space":` via `msg.String()` | 2 locations |
| `tea.NewProgram` options | verify v2 equivalents | 4 call sites |
| `import "github.com/charmbracelet/bubbletea"` | `import tea "charm.land/bubbletea/v2"` | all files |
| `import "github.com/charmbracelet/lipgloss"` | `import "charm.land/lipgloss/v2"` | 12 files |
| `import "github.com/charmbracelet/bubbles/..."` | `import "charm.land/bubbles/v2/..."` | 2 files |

---

## Implementation Phases

### Phase 1: Mechanical v1-to-v2 API Migration

Pure translation -- no behavioral changes. Every test that passed before must pass after.

**Steps**:
1. Update `go.mod`: add `charm.land/bubbletea/v2`, `charm.land/lipgloss/v2`, `charm.land/bubbles/v2`
2. Update all import paths across 24+ files
3. `tea.KeyMsg` -> `tea.KeyPressMsg` in all handlers and tests
4. `View() string` -> `View() tea.View` with `tea.NewView(content)` wrapper for all 3 models (`inlineBubbleModel`, `progressModel`, `promptModel`)
5. `msg.Type`/`msg.Runes` -> `msg.Code`/`msg.Text` in key handlers
6. `tea.KeySpace` -> handle via `msg.String() == "space"` or `msg.Code`
7. `tea.NewProgram` options -- verify v2 equivalents for `WithOutput`, `WithInput`
8. `BUILD.bazel` -- update dependency references
9. Run all tests, `go vet`, visual smoke test

**Validation**: All existing tests pass. Visual output identical. `go vet` clean.

### Phase 2: Re-commit Mechanism Upgrade (Scrollback Duplication Fix)

The most impactful change from the deep research. Replace `\033[2J` with `\033[2J\033[3J` to eliminate scrollback duplication, then enable previously-deferred features.

**Steps**:
1. In `triggerReCommit()` (or the underlying clear sequence): replace `\033[2J\033[1;1H` with `\033[2J\033[3J\033[1;1H`
   - `\033[2J` = Erase in Display (clear visible screen)
   - `\033[3J` = Erase Saved Lines (clear scrollback buffer)
   - `\033[1;1H` = Cursor to home position
2. Verify re-commit works for Ctrl+O toggle with zero scrollback duplication
3. Verify re-commit works for approval collapse with zero scrollback duplication
4. **Enable session header subject update via re-commit**: when `subjectResolved` message arrives, trigger re-commit to show the updated header. This was previously deferred (see `_changelog/2026-03/2026-03-05-094106-fix-duplicate-session-header-on-subject-update.md`) because re-commit duplicated the header. Now safe.
5. **Hide follow-up prompt in expanded mode**: when Ctrl+O toggles to expanded view, the re-committed content should NOT include the follow-up input prompt. Expanded = read mode. When user toggles back to collapsed, the follow-up prompt reappears.
6. Update changelog and design decision docs to reflect the fix

**Trade-off**: Pre-session terminal history (commands run before the Stigmer session) is cleared on re-commit. This matches Claude Code's behavior and is an accepted pattern for AI CLI tools.

**Validation**: Manual test: run a session, do several Ctrl+O toggles, scroll up -- only one copy of content exists. Subject update appears cleanly. Follow-up prompt hidden in expanded mode.

### Phase 3: Follow-up Prompt UX Overhaul (Cursor Positioning)

The original request that sparked this project. Now solved natively with v2.

**Steps**:
1. `formatFollowUpPrompt` -> split into prefix (separator + marker) and footer (hint)
2. `View()` in `textInputActive` state: compose separator + `> ` + buffer + `\n` + footer hint
3. Set `v.Cursor` to position on the input line (after `> ` + buffer text length)
4. Cursor shape: `tea.CursorBar`, blink: true
5. `promptStyle` -> bright white (color 15) instead of blue (color 12) for visibility
6. Full-width separator (terminal width via `termctl.Width` instead of fixed 40)
7. Help text `"enter send . ctrl+c exit"` as footer below input
8. Update `followUpPromptRows` and related constants
9. Update tests for new layout

**Layout result (production TTY)**:
```
────────────────────────────────────────────────────────────
> hello|
  enter send . ctrl+c exit
```
With the real terminal cursor blinking on the input line (after "hello"), not on the footer.

**Validation**: Visual verification that cursor sits on the input line. Tests updated.

### Phase 4: Replace Custom Text Input with bubbles/textinput v2

Replace the 20-line custom buffer with a proper component.

**Steps**:
1. Add `textinput.Model` to `inlineBubbleModel`
2. Route key events to `textinput.Update()` when `textInputActive`
3. `View()` uses `textinput.View()` for the input portion, composed with separator and footer
4. `v.Cursor` set from textinput's cursor position
5. Handle Enter (submit) and Ctrl+C/D (cancel) as before
6. `tea.PasteMsg` -> textinput handles paste natively
7. Remove custom `textInputBuffer` field and `handleTextInputKey` function
8. Update tests

**Gains**: Cursor movement (left/right), word jump (ctrl+left/right), word delete (ctrl+w/backspace), home/end, proper paste handling.

**Validation**: All text input tests updated. Manual verification of cursor movement and paste.

### Phase 5: Ctrl+O During Follow-up Prompt (Unblock Deferred Work)

With textinput as a child model inside the Bubbletea event loop, Ctrl+O and text input coexist.

**Steps**:
1. Restructure `promptFollowUpViaChannel`: instead of blocking on `<-inputCh`, send a message to activate text input mode in the model
2. The model handles both text keys AND Ctrl+O in its `Update()` cycle
3. When user presses Enter: model sends result back via channel
4. `renderInline` event loop continues running during follow-up (does not stop)
5. The toggle signal is processed immediately, not buffered
6. On Ctrl+O during follow-up: re-commit with follow-up prompt hidden (expanded = read mode). When toggled back to collapsed, follow-up prompt reappears with the user's partially-typed input preserved.
7. Update design decision doc `ctrl-o-during-follow-up-prompt.md` to mark resolved

**Validation**: Manual test: press Ctrl+O during follow-up prompt, see immediate re-commit with follow-up hidden. Toggle back, follow-up reappears with previous input.

### Phase 6: Cleanup + Polish

**Steps**:
1. Remove legacy `followUpShowMsg` / key reader path if no longer needed (v2 always owns stdin in TTY)
2. Audit remaining `program == nil` fallback paths -- keep for CI/non-TTY but remove redundant legacy TTY paths
3. Evaluate `tea.KeyboardEnhancementsMsg` for advanced key bindings (shift+enter for multi-line?)
4. Update all design decision documents from projects 01 and 02 to mark resolved items
5. Performance validation with existing benchmarks
6. Visual smoke test of full agent execution session
7. `go vet` clean, all tests pass

---

## What We Are NOT Doing (Explicit Scope Boundaries)

- NOT switching to alt-screen mode -- inline scrollback remains the core design
- NOT moving header into View() -- header stays committed (v2 doesn't change inline mode layout)
- NOT changing stdout/stderr split -- AI streaming still flows through stdout directly
- NOT implementing per-tool expand/collapse -- separate feature project
- NOT implementing terminal resize re-commit -- evaluate feasibility only, defer implementation
- NOT implementing a "mutable window" architecture -- deep research showed this loses terminal scrollback; the `\033[3J` approach is simpler and proven (Claude Code pattern)
- NOT implementing in-app scroll/pager -- users rely on terminal scrollback, which the commit-based architecture preserves

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| v2 released 9 days ago | Potential early bugs | Pin to v2.0.1 (Mar 2 patch). Check in `go.sum`. |
| Lipgloss v2 API changes | Style regressions across 12 files | Test style rendering carefully per file. |
| Cursed Renderer differences | Inline mode edge cases | Phase 1 is mechanical -- catch issues early. |
| bubbles/textinput v2 API | Different from v1 textinput | Read bubbles v2 changelog before Phase 4. |
| BUILD.bazel updates | Build system breakage | Update external deps in Bazel alongside go.mod. |
| `\033[3J` terminal support | May not work in all terminals | xterm-standard, supported by iTerm2, Ghostty, Kitty, Alacritty, WezTerm, macOS Terminal. Test across target terminals. |
| Pre-session history loss on re-commit | Users lose `ls`, `cd` etc. from before session | Accepted trade-off -- matches Claude Code behavior. Only happens on Ctrl+O / approval collapse / subject update. |

---

## Predecessor Project References

| Document | Project | Relevance |
|----------|---------|-----------|
| `design-decisions/001-conservative-bubbletea-integration.md` | 01 | Stdout/stderr split rationale -- stays valid |
| `design-decisions/002-header-stays-committed.md` | 01 | Header in committed region -- stays valid |
| `wrong-assumptions/001-single-writer-all-through-println.md` | 01 | Println is line-based -- stays valid in v2 |
| `design-decisions/ctrl-o-during-follow-up-prompt.md` | 02 | **Resolved by Phase 5** |
| Phase 5 decision: terminal resize deferred | 02 | Evaluate in Phase 6 |
| Phase 5 decision: pre-render in renderer not model | 02 | Stays valid |
| "Future: advanced text input" | 02 next-task.md | **Resolved by Phase 4** |
| "Future: per-tool expand/collapse" | 02 next-task.md | Out of scope |
| `_changelog/2026-03-05-094106-fix-duplicate-session-header-on-subject-update.md` | post-02 | **Resolved by Phase 2** (`\033[3J` makes re-commit safe for subject updates) |
| `_changelog/2026-03-05-105601-fix-skip-approval-collapse-ux.md` | post-02 | **Improved by Phase 2** (approval collapse re-commit no longer duplicates scrollback) |
| `research.inline-rerender-without-scrollback-duplication/04.report.gpt.md` | 03 | Deep research report -- foundational for Phase 2 decisions |

## Success Criteria for T01

1. All v1 API usage migrated to v2 equivalents (Phase 1)
2. Re-commit produces zero scrollback duplication -- verified by scrolling up after Ctrl+O toggle (Phase 2)
3. Session header subject update renders cleanly via re-commit (Phase 2)
4. Follow-up prompt hidden in expanded mode, visible in collapsed mode (Phase 2)
5. Follow-up prompt has cursor on input line with footer below -- Claude Code quality (Phase 3)
6. `bubbles/textinput` v2 replaces custom text input buffer (Phase 4)
7. Ctrl+O works during follow-up prompt -- deferred limitation resolved (Phase 5)
8. Zero UX regression across all phases
9. All tests pass, `go vet` clean

## Next Task Preview

**T02: Execute Phase 1** -- Mechanical v1-to-v2 API translation across all files.

## Review Process

**What happens next**:
1. **You review this plan** -- consider the phasing, scope, and trade-offs
2. **Provide feedback** -- share concerns, alternative ideas, or changes
3. **I'll revise** -- incorporate feedback into this plan
4. **You approve** -- explicit approval to proceed
5. **Execution begins** -- tracked in T01_1_execution.md

**Please consider**:
- Does the 6-phase approach make sense, or should phases be reordered/combined?
- Is the "mechanical first, features second" strategy right for de-risking?
- Phase 2 (re-commit fix) could technically be done independently of the v2 migration -- should it be a separate task?
- Any concerns about the v2 freshness (9 days since release)?
- Should we pin to v2.0.1 or wait for a few more patch releases?
- Is the `\033[3J` trade-off (losing pre-session terminal history) acceptable?
- Is the follow-up prompt UX (cursor on input, footer below) the right target?
- Should Phase 5 (Ctrl+O during follow-up) be in scope or deferred?
