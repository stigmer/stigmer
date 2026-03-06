---
name: Fix Collapse + Prompt UX
overview: Fix the write tool approval collapse bug (partial erasure) and upgrade the follow-up input prompt to a Claude Code-style three-section layout with separator, styled input, and hint footer.
todos:
  - id: termctl-save-restore
    content: Add SaveCursor/RestoreCursorAndClear to termctl.go using DEC escape sequences (\033 7 / \033 8\033[J)
    status: completed
  - id: fix-collapse-streaming
    content: Update initPreApprovalStreaming to save cursor before expanded view; add cursorSaved field to inlineRenderer
    status: completed
  - id: fix-collapse-approval
    content: Replace EraseLines(totalRows) with RestoreCursorAndClear in finalizeApproval, handleNonInteractiveApproval, handlePromptError, and prepareApprovalDisplay
    status: completed
  - id: fix-collapse-tests
    content: Update approval and streaming tests to verify cursor save/restore sequences
    status: completed
  - id: prompt-ux-render
    content: Add renderFollowUpPrompt helper and followUpHintStyle in run_display.go
    status: completed
  - id: prompt-ux-followup
    content: Update readFollowUpInput to render separator + prompt + hint; update erasure count in runInlineFollowUpLoop
    status: completed
  - id: prompt-ux-tests
    content: Update follow-up tests for new prompt structure and erasure row count
    status: completed
isProject: false
---

# Fix Write Tool Collapse and Upgrade Follow-up Prompt

## Issue 1: Write Tool Approval Collapse -- Partial Erasure Bug

### Root Cause Analysis

The approval collapse relies on `DisplayRows` to estimate terminal rows, then `EraseLines` to erase them. The user reports that after approving a write tool, only the bottom half is erased -- the top portion (separator + header + first N lines of YAML) remains as ghost content above the collapsed result.

The previous fix ([changelog](client-apps/cli/cmd/stigmer/root/run_stream_inline_header_update.go)) addressed `termctl.IsSupported` failing through the `lineCountingWriter` wrapper, which caused `canCollapse = false`. That fix restored collapse functionality, but the **row count** is still inaccurate.

**Why `DisplayRows` underestimates rows:** The streamed YAML content (screenshot shows a multi-line `description:` field with 70-80 char lines) may wrap on the actual terminal, creating more visual rows than `DisplayRows` computes. Additionally, `Width` is computed independently at streaming time and at collapse time -- any discrepancy (terminal resize, width detection variance) compounds the error.

### Proposed Fix: ANSI Cursor Save/Restore

Replace the fragile `DisplayRows`-based row counting with ANSI cursor save/restore for the approval collapse. This eliminates the entire class of row-miscounting bugs.

**Approach:**

1. Before the expanded view begins, emit `\033 7` (DEC save cursor position)
2. After the user decides, emit `\033 8\033[J` (DEC restore cursor + clear to end of screen)

This replaces `termctl.EraseLines(r.cfg.status, totalRows)` in `finalizeApproval` and related paths.

**DEC vs SCO save/restore:** `UpdateSubject` in [run_stream_inline_header_update.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_header_update.go) uses SCO-style `\033[s`/`\033[u`. The approval flow will use DEC-style `\033 7`/`\033 8` to avoid save-slot conflicts. Most modern terminals (iTerm2, Terminal.app, Alacritty, kitty, Windows Terminal) maintain separate save slots for DEC and SCO.

**Files to change:**

- [pkg/termctl/termctl.go](client-apps/cli/pkg/termctl/termctl.go) -- add `SaveCursor(w)` and `RestoreCursorAndClear(w)` functions using DEC save/restore
- [run_stream_inline_streaming.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming.go) -- `initPreApprovalStreaming` saves cursor before printing separator+header
- [run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go):
  - `finalizeApproval` -- replace `EraseLines(totalRows)` with `RestoreCursorAndClear`
  - `prepareApprovalDisplay` -- save cursor when `contentStreamed=false` (non-streaming path)
  - `handleNonInteractiveApproval` -- same replacement
  - `handlePromptError` -- same replacement
- [run_stream_inline.go](client-apps/cli/cmd/stigmer/root/run_stream_inline.go) -- add a `cursorSaved bool` field to `inlineRenderer` to gate restore calls
- Keep `DisplayRows` and `streamLineCount` tracking for the non-interactive fallback and for terminals where save/restore is unavailable (add a `SaveCursorSupported` check or fall back to the current approach if save fails)

**Test updates:**

- [run_stream_inline_approval_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval_test.go) -- update assertions for ANSI sequences
- [pkg/termctl/termctl_test.go](client-apps/cli/pkg/termctl/termctl_test.go) -- add tests for `SaveCursor`/`RestoreCursorAndClear`
- [run_stream_inline_streaming_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_streaming_test.go) -- verify save cursor is emitted

---

## Issue 2: Follow-up Input Prompt UX Upgrade

### Current State

The follow-up prompt in [run_stream_inline_followup.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go) renders `\n>`  (styled blue bold via `promptStyle`). After input, it erases 2 rows and re-renders as a styled human message. No separator, no hints.

### Target UX

Three visual sections when execution completes and the user is prompted for follow-up:

```
[streaming output ends here]

────────────────────────────────────────
> [cursor]
  enter send · ctrl+c exit
```

- **Separator**: Thin horizontal rule (reuse `dimStyle` with `"─"` chars, matching approval separator aesthetic but wider)
- **Prompt**: Styled bold-blue `>` (existing `promptStyle`)
- **Hint footer**: Dim italic line below the prompt with available actions

### Implementation

**File: [run_stream_inline_followup.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup.go)**

`readFollowUpInput` changes:

```go
func readFollowUpInput(status io.Writer) (string, error) {
    width := termctl.Width(status, 40)
    sep := dimStyle.Render(strings.Repeat("─", min(width, 40)))
    hint := hintStyle.Render("  enter send · ctrl+c exit")
    
    fmt.Fprintf(status, "\n%s\n%s ", sep, promptStyle.Render(">"))
    // Print hint below prompt, then move cursor back up
    fmt.Fprintf(status, "\n%s\033[1A\033[%dC", hint, promptWidth)
    
    // ... scanner read ...
}
```

After input, erase the separator + prompt + hint (4 rows instead of 2):

```go
if termctl.IsSupported(cfg.status) {
    termctl.EraseLines(cfg.status, 4)
}
```

**File: [run_display.go](client-apps/cli/cmd/stigmer/root/run_display.go)**

- Add `followUpSepStyle` (or reuse `dimStyle`) for the separator
- Add `followUpHintStyle` (dim + italic, matching approval menu hint)
- Add a `renderFollowUpPrompt(status io.Writer) int` helper that returns the row count for clean erasure

**Styles** -- use the existing `hintStyle` from [inline_prompter.go](client-apps/cli/pkg/approval/inline_prompter.go) (dim italic foreground "8") for consistency with the approval menu.

**Test updates:**

- [run_stream_inline_followup_test.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_followup_test.go) -- update prompt assertions, verify separator and hint are rendered, update erasure row count checks

---

## Architectural Notes

- **No new dependencies**: Both changes use lipgloss and termctl already in the tree
- **Graceful degradation**: On dumb terminals and pipes, cursor save/restore is gated by `termctl.IsSupported`; the hint line uses ANSI cursor positioning that degrades to a visible-but-misplaced hint on non-TTY writers
- **stdout/stderr separation preserved**: All new rendering goes to stderr; stdout remains clean for piping
- **DEC save/restore is well-supported**: iTerm2, Terminal.app, Alacritty, kitty, WezTerm, Windows Terminal all support `\033 7`/`\033 8` with independent save slots from SCO `\033[s`/`\033[u`

---

## Challenge / Pushback

The ANSI cursor-below-prompt technique (print hint, move cursor back up) works well for the follow-up prompt but introduces a dependency on cursor positioning during INPUT reading. If the terminal doesn't support `\033[1A` (cursor up), the hint would appear above the prompt instead of below. This is a minor degradation that I believe is acceptable -- on truly dumb terminals, the hint still renders, just in a slightly different position. The alternative (printing hint above prompt, no cursor movement) is simpler but places the hint in a less conventional position.