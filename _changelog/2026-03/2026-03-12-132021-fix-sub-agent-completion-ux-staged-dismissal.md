# Fix Sub-Agent Completion UX: Staged Dismissal and Priority Cascade

**Date**: March 12, 2026

## Summary

Sub-agent completion was invisible in the Stigmer CLI — spinners vanished instantly with no "done" indicator, and the priority cascade hid sub-agent status entirely once the main agent started generating its response. This change introduces staged dismissal (a 1.5-second static completion indicator before scrollback commit) and fixes the rendering priority so sub-agents remain visible alongside AI streaming.

## Problem Statement

When a sub-agent finished its work, the CLI's Bubbletea TUI would atomically remove the spinner and commit the result to scrollback in a single `Update()` call. While this eliminated a previous two-frame rendering glitch, it created a new UX problem: users never saw the sub-agent complete. The spinner simply disappeared.

### Pain Points

- Sub-agent completion was a non-event — the spinner vanished between frames with no visual confirmation
- When the main agent started streaming its response (AI stream), `renderTransientContent()`'s priority cascade (`aiStreamActive` case) would completely hide any remaining sub-agent entries, making parallel sub-agent work invisible
- Users reported confusion about whether sub-agents actually completed or silently failed
- The completion → scrollback transition was abrupt with no visual continuity between the live indicator and the historical record

## Solution

Two complementary fixes that together make sub-agent lifecycle fully visible:

1. **Staged Dismissal**: Sub-agent completion transitions through a brief visible state — the spinner is replaced by a static status indicator (checkmark, X, or cancel icon) for 1.5 seconds before the entry is dismissed to scrollback. This gives users visual confirmation without cluttering the display.

2. **Priority Cascade Fix**: Sub-agent status lines now render *above* AI streaming content in both rendering paths (interactive `renderTransientContent()` and legacy `View()`), following the same pattern already established by the approval rendering case.

## Implementation Details

### New Types and Messages

- **`completedSubAgentEntry`** struct in `run_stream_inline_types.go` — holds the pre-styled `displayLine` and deferred `scrollbackLines` for a recently-completed sub-agent
- **`subAgentDismissMsg`** in `run_stream_inline_messages.go` — fires after the completion indicator's visible duration expires, triggers scrollback commit and removal
- **Extended `subAgentCompleteMsg`** — new `displayLine` field carries the pre-styled completion summary; empty `displayLine` falls back to immediate commit (backward compatibility)

### Staged Dismissal Flow

```
subAgentCompleteMsg arrives
  → Remove from activeSubAgentEntries
  → Add to completedSubAgentEntries with displayLine
  → Start tea.Tick(1.5s) → subAgentDismissMsg

subAgentDismissMsg fires
  → Commit scrollbackLines via tea.Println
  → Remove from completedSubAgentEntries
```

### Rendering Changes

- **`renderSubAgentLine()`** renders completed entries (static displayLine) first, then active entries (animated spinner) — completed entries stack above active ones
- **`renderTransientContent()`** `aiStreamActive` case changed from returning just `m.aiStreamPartial` to `subAgentView + "\n\n" + m.aiStreamPartial` — sub-agents visible above the stream
- **`hasSubAgentActivity()`** helper replaces raw `len(m.activeSubAgentEntries) > 0` checks to include both active and completed lists
- **`formatSubAgentCompletionLine()`** in the renderer generates the completion line using the same visual language as scrollback's collapsed view (green bullet, bold label, status icon)

### Test Coverage

- 28 total tests (16 new, 3 rewritten to match new staged behavior, 9 existing unchanged)
- Covers: staged transition, dismiss handler, fallback path, unknown ID handling, AI stream coexistence, completed-only rendering, mixed active/completed rendering, `hasSubAgentActivity` logic

## Benefits

- Sub-agent completion is now a visible event — users see the checkmark/status before it scrolls away
- Sub-agents remain visible during AI streaming, giving full awareness of parallel work
- Smooth visual transition from live indicator to scrollback record (same visual language in both states)
- Backward-compatible fallback for any code path that doesn't produce a `displayLine`
- Named constant (`subAgentCompletionVisibleDuration`) makes the timing trivially tunable

## Impact

- **End users**: Sub-agent lifecycle is fully visible — start, progress, and completion all have distinct visual states
- **CLI rendering**: Both rendering paths (interactive and legacy) now handle the sub-agent/AI-stream overlap correctly
- **Architecture**: Establishes the `completedEntries + tea.Tick dismiss` pattern that can be reused for other transient indicators (e.g., future compaction notifications)

## Related Work

- Part of project `20260312.01.agent-execution-consistency-guardrails` (PR4 of 5)
- Builds on the sub-agent rendering infrastructure from project `20260309.01.sub-agent-execution-streamline`
- The atomic hide-and-println approach (PR3 from the prior project) fixed a two-frame glitch but introduced the instant-vanish problem this change resolves
- Previous changelogs in this series: `2026-03-12-105522-fix-recursion-limit-10x-inflation.md` (PR3), `2026-03-12-111751-fix-loop-detection-middleware-dead-code.md` (PR1), `2026-03-12-121137-fix-mid-execution-context-overflow-compaction.md` (PR2), `2026-03-12-124514-detect-abnormal-graph-termination.md` (PR5)

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (Session 5)
