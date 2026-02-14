# T01 Revised Plan: Interactive CLI Experience

**Created**: 2026-02-14
**Status**: PENDING APPROVAL
**Revision**: Incorporates developer feedback from T01_1_review.md

---

## Confirmed Decisions

| Decision | Resolution |
|----------|-----------|
| TUI framework | **Bubbletea** — full TUI with spinners, panels, structured layout |
| `--follow` flag | **Remove entirely** — always stream, no opt-out |
| Approval panel | **Box-drawn panels** with tool-type-aware argument display |
| Scope | **All tasks** (T02–T05), no down-prioritization |

---

## Execution Plan

### T02: Streaming-First Execution Engine

**Files to change**:
- `draft_skill_handler.go` — Remove `go streamAgentExecutionLogs` + `waitForExecution` dual path. Single streaming path.
- `draft_skill.go` — Remove `--follow` flag entirely.
- `run_stream.go` — Refactor to be the primary execution path. Return final execution state.
- `run_handlers.go` — `waitForExecution` becomes internal fallback for non-TTY only (piped output, CI).

**Outcome**: Every interactive execution streams by default. No flag needed.

### T03: Rich Approval Experience

**Files to change**:
- `run_display_approval.go` — Complete rewrite with Bubbletea-rendered box panels.
- `pkg/approval/interactive.go` — Replace Survey with Bubbletea selection model.
- New: `pkg/approval/formatter.go` — Tool-type-aware argument formatter.
- New: `internal/cli/panel/panel.go` — Reusable box-drawing panel renderer.

**Outcome**: Approval prompts are unmistakable, informative, and visually distinct.

### T04: Live Progress & Structured Tool Display

**Files to change**:
- `run_display.go` — Type-aware message rendering (AI messages word-wrapped, tool calls structured).
- `run_stream.go` — Integrate Bubbletea spinner between message events.
- New: `internal/cli/spinner/spinner.go` — Bubbletea spinner with elapsed time.
- New: `internal/cli/toolrender/render.go` — Smart tool call renderer (shell → command, read → path, etc.).

**Outcome**: User always knows what's happening. Tool calls are readable and categorized.

### T05: Polish & Edge Cases

**Files to change**:
- All display files — Consistent color hierarchy (dim for metadata, bright for actions).
- Error display — Structured error panels matching approval panel style.
- Non-TTY — Plain text fallback (no Bubbletea, no spinners, no box drawing).
- Execution summary — Timing breakdown, tool call count, artifact summary.

**Outcome**: The experience feels intentional and polished in every environment.

---

## Implementation Order

```
T02 (Streaming Engine)
  ├──→ T03 (Approval UX)  ──┐
  └──→ T04 (Progress/Tools) ─┤──→ T05 (Polish)
                              │
```

Start with T02 since T03 and T04 both depend on the streaming-first foundation.
