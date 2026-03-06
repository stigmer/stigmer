# Task T01: Architecture Design and Implementation Plan

**Created**: 2026-03-05
**Status**: PENDING REVIEW
**Type**: Feature Development
**Dependency**: Requires completion of `20260305.01.bubbletea-inline-renderer` (Bubbletea migration)

> **This plan requires your review before execution**

## Objective

Build an event history + clear+re-commit mechanism that enables two features:

1. **Expand/collapse toggle** (like Claude Code's Ctrl+O) — lets users switch between compact and expanded rendering of tool call results and read-file groupings at runtime, even for content already committed to terminal scrollback.
2. **Session header subject update** — the header initially renders without a Subject; when the backend resolves the subject (2-10s later), the header re-renders with the subject filled in, replacing the fragile ANSI cursor-save/restore approach that was deleted in Phase 3 of the Bubbletea migration.

## The Core Problem

Bubbletea inline mode has two rendering regions:

- **Committed region**: Content written via `tea.Println()` — lives in terminal scrollback, Bubbletea forgets about it immediately.
- **Active view**: Content rendered by `View()` at the bottom — Bubbletea re-renders this on every frame.

Once a tool call is rendered in compact form via `Println`, Bubbletea has no handle to go back and change it. An expand/collapse toggle needs to change already-committed content. Similarly, the session header is committed before Bubbletea starts — when the Subject resolves later, there's no clean way to update the header without the deleted ANSI cursor math.

## Current State Analysis

| Aspect | Current State | Gap |
|--------|--------------|-----|
| **Bubbletea model** | Tracks only spinner state (`spinnerActive`, `spinnerFrame`, `spinnerLabel`, `spinnerStart`) | No event history at all |
| **inlineRenderer** | Keeps transient state (`pendingReads`, `waitingApproval`, `suppressedToolIDs`) | Discards structured data after `statusf`/`Println` |
| **toolrender** | Has `RenderCompact`, `RenderReadGroup` for compact; `ExpandedApprovalHeader`/`ExpandedApprovalContent` for approval expanded view | No general-purpose expanded renderer for arbitrary tool completions |
| **Key binding handling** | Bubbletea uses `tea.WithInput(nil)` — does not own stdin | Cannot receive keypresses via `Update()` |
| **Read grouping** | `pendingReads` buffer flushed on non-read output; `RenderReadGroup` when `len >= 3` | Group structure not retained after rendering |
| **Session header** | Rendered once to stderr before Bubbletea starts; Subject field omitted for new sessions (Phase 3 decision) | No mechanism to update header after initial render; subject display sacrificed |

## Solution: Clear + Re-commit from Retained Event History

### The Key Insight

`Println` is a **display optimization**, not the source of truth. If the model retains the structured data for every committed item, we can always re-render the entire session in a different mode by:

1. Clearing the terminal screen
2. Re-committing all historical content from model state using the toggled rendering mode
3. Resuming normal rendering

### Broader Value: One Mechanism, Multiple Triggers

The event history + clear+re-commit pattern is not specific to expand/collapse. It's a general-purpose "re-render the entire session" capability:

| Trigger | What Mutates | Result |
|---------|-------------|--------|
| Subject resolved | `history[0].header.subject` | Header re-renders with subject |
| Ctrl+O pressed | `m.expandMode` | All tool calls toggle compact ↔ expanded |
| Terminal resize (future) | nothing — just re-render at new width | Content reflows correctly |
| Theme toggle (future) | `m.theme` | Everything re-renders with new styles |

Phase 1 implements the mechanism with subject update as the first concrete, visible use case. The expand/collapse toggle builds on the same foundation in later phases.

### How Claude Code Does It (for reference)

Claude Code uses Ink (React for terminals). Ink keeps all content in a React component tree and re-renders the full tree on every change — there is no "commit" concept. Toggle is trivial: change a prop, re-render. The tradeoff is Ink re-renders the entire session history every frame. Bubbletea's Println commit model is more performant for long sessions but requires the clear+re-commit approach for toggle.

## Architecture Design

### New Data Structures

```go
// committedItem represents one unit of committed output that can be re-rendered.
// Stored in the model's event history after each Println.
type committedItem struct {
    kind      committedKind
    toolCalls []toolrender.ToolCallInfo  // for tool/readGroup items
    subAgent  string                      // sub-agent ID if applicable
    text      string                      // for text items (AI messages, separators)
    action    string                      // for approval results (approve/skip/reject)
    header    *headerData                 // for session header (mutable subject)
}

type headerData struct {
    agent      string
    session    string
    subject    string   // initially empty, updated when resolved
    model      string
    workspaces []string
}

type committedKind int

const (
    kindText        committedKind = iota  // AI message, human message, separator
    kindHeader                             // session header panel (subject is mutable)
    kindToolCompact                        // single tool call (compact or expanded)
    kindReadGroup                          // grouped read calls
    kindApproval                           // approval result line
)
```

### Model State Addition

```go
type inlineBubbleModel struct {
    // existing spinner fields...

    // Event history for re-rendering
    history     []committedItem
    expandMode  bool  // false = compact (default), true = expanded

    // Compact rendering options (needed for re-render)
    compactOpts toolrender.CompactOptions
}
```

### Re-commit Flow (shared by all triggers)

The same clear+re-commit mechanism handles every trigger. Only the mutation differs.

```
Trigger arrives (Ctrl+O, subject resolved, future: terminal resize)
       │
       ▼
Update() mutates model state:
  Ctrl+O          → m.expandMode = !m.expandMode
  subject resolved → m.history[0].header.subject = msg.subject
       │
       ▼
return m, tea.Sequence(
    tea.ClearScreen,       // clear terminal
    reCommitAllCmd(m),     // re-Println all history items with current state
)
       │
       ▼
Each history item re-rendered using current state:
  kindHeader      → formatSessionHeaderContent() with current subject
  kindToolCompact → RenderCompact() or RenderExpanded() based on expandMode
  kindReadGroup   → RenderReadGroup() or individual expanded reads
  kindApproval    → RenderApprovalResult() (unchanged)
  kindText        → text as-is
       │
       ▼
View() continues rendering active region normally
```

### Subject Update Flow (specific)

```
Backend resolves subject (2-10s into session)
       │
       ▼
pollSessionSubject goroutine calls program.Send(subjectResolvedMsg{subject: "..."})
       │
       ▼
Update() receives subjectResolvedMsg
       │
       ▼
m.history[0].header.subject = msg.subject   // header is always history[0]
       │
       ▼
return m, tea.Sequence(tea.ClearScreen, reCommitAllCmd(m))
       │
       ▼
Header re-renders with subject filled in.
Remaining items (tool calls, AI messages) re-render identically.
```

**Why this is lightweight for subject update**: The subject resolves 2-10 seconds into the session, typically before much output exists. The re-commit is near-instant — maybe 3-5 committed items.

### Expand/Collapse Toggle Flow (specific)

```
User presses Ctrl+O
       │
       ▼
tea.KeyMsg{} received in Update()
       │
       ▼
m.expandMode = !m.expandMode
       │
       ▼
return m, tea.Sequence(tea.ClearScreen, reCommitAllCmd(m))
       │
       ▼
All tool calls re-render in toggled mode.
Header, AI messages, separators re-render identically.
```

### Stdin Ownership Change

Currently Bubbletea uses `tea.WithInput(nil)` — it cannot receive keypresses. For the toggle to work, Bubbletea must own stdin (at least during non-approval periods). This requires:

1. Remove `tea.WithInput(nil)` — let Bubbletea read stdin
2. Route the toggle keypress (`Ctrl+O`) through `Update()`
3. During approval flow, either:
   - Forward non-toggle keys to the approval prompter, or
   - Temporarily release stdin to the approval flow (complex)

This is the most architecturally significant change and intersects with Phase 4 of the Bubbletea migration project (approval flow migration). **The approval flow must be event-driven before this project can begin.**

## Implementation Phases

### Phase 1: Event History Retention + Subject Update (First Use Case)

**Goal**: Every item committed via `Println` also gets stored as a `committedItem` in the model. The session header is the first history item, with a mutable subject field. When the subject resolves, the model triggers clear+re-commit — validating the entire mechanism end-to-end with a real, visible use case.

**Changes**:
- Define `committedItem`, `committedKind`, and `headerData` types
- Add `history []committedItem` to model
- Session header rendered as `history[0]` with `kind: kindHeader` and `header.subject: ""`
- Wrap `statusf` / the Println call path to also append to history for all subsequent items
- Restore `pollSessionSubject` goroutine (deleted in Phase 3 of Bubbletea migration) — but now it sends `subjectResolvedMsg` via `program.Send()` instead of ANSI cursor math
- `Update()` handles `subjectResolvedMsg`: sets `m.history[0].header.subject`, returns `tea.Sequence(tea.ClearScreen, reCommitAllCmd(m))`
- `reCommitAllCmd` iterates history, renders each item via `tea.Println`; header uses `formatSessionHeaderContent()` with current subject
- Session header template re-includes the Subject field (with blank placeholder initially, like before Phase 3)

**Validation**:
- Unit test: history grows as events are processed
- Unit test: re-commit produces identical output to original
- Integration test: subject update triggers re-commit, header re-renders with subject
- Visual verification: new session shows header → subject appears after 2-10s with no visual glitch beyond a brief repaint

### Phase 2: General-Purpose Expanded Renderer

**Goal**: `toolrender` can render any tool call in expanded form, not just approval-related ones.

**Changes**:
- New function: `RenderExpanded(tc ToolCallInfo, opts CompactOptions) string`
  - Shows tool name, all arguments, full result/output
  - Reuses `ExpandedApprovalContent` logic where applicable
  - Handles read, write, shell, discovery, delete, think, unknown/MCP tools
- New function: `RenderReadGroupExpanded(reads []ToolCallInfo, opts CompactOptions) string`
  - Shows each read individually with file content preview

**Validation**: Unit tests for each tool type in expanded mode. Golden file comparisons.

### Phase 3: Clear + Re-commit Mechanism

**Goal**: The model can clear the terminal and re-commit all history items.

**Changes**:
- `reCommitAll(m *inlineBubbleModel) tea.Cmd` — iterates `m.history`, renders each item in current `expandMode`, emits `tea.Println` for each
- Handle `tea.ClearScreen` followed by re-commit as a `tea.Sequence`
- Handle edge case: what if AI is actively streaming during toggle? The active stream continues in `View()` (unaffected); only committed items are re-rendered

**Validation**: Test that clear+re-commit produces identical output to original for compact mode. Test that expanded mode produces expanded output.

### Phase 4: Keybinding and Stdin

**Goal**: Ctrl+O toggles expand mode.

**Changes**:
- Bubbletea owns stdin (remove `tea.WithInput(nil)`)
- `Update` handles `tea.KeyMsg` for Ctrl+O → toggles `expandMode`, triggers clear+re-commit
- All other keypresses: either ignored or forwarded (depends on approval flow state)
- This phase depends heavily on the approval flow being fully migrated to Bubbletea's event-driven model

**Validation**: Manual test — press Ctrl+O during a session, see tool calls expand/collapse.

### Phase 5: Polish and Edge Cases

**Goal**: Handle edge cases and optimize.

**Changes**:
- **Long sessions**: Profile clear+re-commit with 500+ history items. If slow, consider batching Println calls or using a single large write
- **Mid-stream toggle**: Ensure active AI streaming and spinner are unaffected during re-commit
- **Terminal resize during re-commit**: Handle gracefully
- **Visual indicator**: Show current mode in the session header (e.g., `[compact]` / `[expanded]` — the header is already a re-renderable history item)
- **Partial expand**: Consider letting users expand individual tool calls (future — not required for v1)

**Validation**: Smoke test with real agent execution. Edge case testing.

## What Needs to Exist First (Prerequisites from Bubbletea Migration)

| Prerequisite | Why | Migration Phase |
|-------------|-----|----------------|
| Approval flow is event-driven (not blocking) | Ctrl+O keybinding needs Bubbletea to own stdin | Phase 4 |
| Follow-up prompt is in View() | Same stdin ownership requirement | Phase 6 |
| All `termctl.EraseLines` eliminated | Clear+re-commit assumes Bubbletea manages all cursor movement | Phase 7 |

**This project should start after the Bubbletea migration is complete (all 7 phases).**

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Clear+re-commit is slow for very long sessions (500+ items) | Visual flash/delay on toggle | Profile early; batch Println calls; consider writing directly to output instead of individual Printlns |
| Stdin ownership conflicts with approval flow | Toggle doesn't work during approval | Design approval as a Bubbletea state where Ctrl+O is handled separately from menu navigation |
| Memory growth from retaining all event data | Increased memory for long sessions | `committedItem` is lightweight (stores ToolCallInfo references, not rendered strings); negligible vs gRPC message buffers |
| AI streaming during toggle | Visual glitch | Active stream is in View() (unaffected by clear+re-commit of committed items) |
| Terminal compatibility (ClearScreen) | May not work on all terminals | `tea.ClearScreen` is well-tested in Bubbletea; fallback to ANSI `\033[2J\033[H` |

## Files Inventory (Estimated)

### New
- `run_stream_inline_history.go` — `committedItem` types, history append logic, re-commit function
- `pkg/toolrender/render_expanded.go` — general-purpose expanded rendering

### Modified
- `run_stream_inline_bubbletea.go` — model gains history, expandMode, Ctrl+O handler
- `run_stream_inline.go` — wrap statusf to also record history items
- `run_stream_inline_approval.go` — approval results recorded in history
- `pkg/toolrender/render_compact.go` — may need to export some internal helpers for expanded renderer

### Unchanged
- `run_stream_json.go` — separate code path
- `run_stream_events.go` — event production unchanged
- `pkg/panel/`, `pkg/termctl/` — utility packages unchanged

## Success Criteria

1. Session header Subject field is restored — renders blank initially, updates in-place when resolved (no ANSI cursor math, uses clean clear+re-commit)
2. User can press Ctrl+O to toggle between compact and expanded tool call views
3. Toggle works for already-committed content (visible tool calls re-render)
4. Read-file groups expand to show individual files with content previews
5. Toggle during active AI streaming does not disrupt the stream
6. Performance acceptable for sessions with 100+ tool calls (< 500ms re-commit)
7. Zero regression in non-toggle behavior (compact mode looks identical to today)

## Next Task Preview

**T02: Implement Phase 1 (Event History Retention)** — Add `committedItem` types and history tracking to the model without any behavioral change.

## Review Process

**What happens next**:
1. **You review this plan** — consider the approach, especially the clear+re-commit strategy and stdin ownership change
2. **Provide feedback** — share concerns, alternative ideas, or changes
3. **I'll revise** — create T01_2_revised_plan.md incorporating feedback
4. **You approve** — explicit approval to proceed
5. **Execution begins** — after Bubbletea migration completes

**Please consider**:
- Does the clear+re-commit approach feel acceptable (brief visual flash on toggle)?
- Is Ctrl+O the right keybinding, or prefer something else?
- Should expanded view show full tool output or truncated (like approval's `TruncateContent`)?
- Any concerns about stdin ownership change intersecting with approval flow?
- Is partial expand (per-tool-call toggle) something to design for in v1 or defer?
