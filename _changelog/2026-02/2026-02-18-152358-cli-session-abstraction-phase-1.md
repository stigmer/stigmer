# CLI Session Abstraction Phase 1

**Date**: February 18, 2026

## Summary

Introduces "session" as a first-class user-facing concept in the Stigmer CLI. Users can now re-open existing sessions by ID, discover past sessions via `stigmer list sessions`, and view completed sessions in a read-only TUI replay. Execution internals (phase change blocks, verbose post-run panels) are replaced by a cleaner, session-centric UX.

## Problem Statement

The CLI exposed raw execution IDs and backend lifecycle internals to users, creating friction and confusion. Specifically:

### Pain Points

- `stigmer run` produced a new anonymous execution every time — no way to re-attach or reference a previous run
- `stigmer list executions` returned opaque execution IDs with no session grouping
- The TUI displayed phase change transitions (`PENDING → IN_PROGRESS`) as visible transcript blocks, cluttering the output
- Post-run summaries were verbose multi-panel displays even for simple completions
- Completed sessions were inaccessible — users had to remember execution IDs with no re-open mechanism
- The TUI header showed "Execution: exec-xxx" with no higher-level session identity

## Solution

Implemented a session client package and extended the CLI's `run` and `list` commands to understand session IDs. Added a replay mode to the Bubbletea TUI that renders a completed execution's transcript in read-only form. Replaced verbose post-TUI panels with concise single-line exit messages, and suppressed lifecycle noise from the transcript view.

## Implementation Details

### New: Session Client Package (`internal/cli/session/`)

- **`get.go`**: `GetFromBackend(conn, sessionID)` — fetches a single `Session` proto via `SessionQueryController.Get`, validated against `reference.IsSessionID()`.
- **`list.go`**: `List(opts)` — paginates sessions via `SessionQueryController.List` with configurable page size and tag filtering.
- **`display.go`**: `DisplayResult` / `DisplayListResult` — renders session details and tables (table / YAML / JSON formats); timestamps from `status.audit.spec_audit.created_at`.

### Extended: `stigmer run` accepts session IDs (`run.go`, `run_session.go`)

- The `Args` validator now accepts either `<type> <reference>` (existing) or a single session ID (`ses-xxx`).
- When a session ID is provided, `executeRunSession()` connects to the backend and calls `openSession()`.
- `openSession()` fetches the session, retrieves the latest execution, and routes:
  - **Live phases** (pending, in-progress, waiting, paused): re-attaches via `streamAgentExecution`.
  - **Terminal phases** (completed, failed, cancelled, terminated): launches `replayAgentExecution` (TUI replay).

### New: TUI Replay Mode (`pkg/executiontui/replay.go`)

- `BuildReplayBlocks(exec)` converts stored `AgentExecution` messages and tool calls into `contentBlock` slices — identical visual language to the live TUI.
- `NewReplay(cfg)` constructs a `Model` pre-populated with replay blocks, `done: true`, and `autoScroll: false` for comfortable read-only browsing.
- Replay models skip event listeners and activity ticks (`Init()` returns `nil`), and initialize viewport directly on `WindowSizeMsg`.

### Session-Aware TUI Header (`pkg/executiontui/view.go`, `model.go`)

- `Config` gains a `SessionID string` field.
- `renderHeader()` displays `Session: ses-xxx` when `SessionID` is set, falling back to `Execution: exec-xxx`.

### Session-Aware Exit Messages (`run_display_summary.go`, `run_stream.go`)

- `displaySessionExitLine(sessionID, exec)` — prints a single line summarising completion, failure, cancellation, or termination, plus the `stigmer run <id>` re-open command.
- `displaySessionDetachLine(sessionID)` — prints a single detach line with re-open instructions.
- `streamAgentExecution` now accepts `sessionID` as its first argument; when non-empty, it switches from verbose panel summaries to these concise lines.

### Suppressed Phase-Change Blocks (`pkg/executiontui/handle_events.go`)

- `PhaseChangeEvent` and `DoneEvent` no longer emit a `newPhaseBlock()` into the transcript. The phase state still drives the spinner/header, but the lifecycle transitions are invisible to the user.

### Extended: `stigmer list sessions` (`list.go`)

- `isSessionType()` recognises `sessions`, `session`, `ses` as type arguments.
- `executeListSessions()` connects, calls `session.List()`, and renders via `session.DisplayListResult()`. Shows a friendly tip if no sessions exist yet.

### `runAgent` and `executeDraftSkill` updated

- Both now extract `sessionID` from the newly created execution's spec and print `Session started: <id>` (or fall back to execution ID if no session is assigned).
- `sessionID` is forwarded to `streamAgentExecution`.

### Test Fixes

- `help_test.go`: updated assertion from "Quit" to "Detach" to match actual help text.
- `update_test.go`: corrected expected block counts (5→4) and focus indices (6→5) to reflect the removal of phase-change blocks.

## Benefits

- **Re-attach without context loss**: `stigmer run ses-xxx` works from any terminal, any time.
- **Session discovery**: `stigmer list sessions` provides a self-contained history of work.
- **Cleaner TUI**: no lifecycle noise in the transcript; users see content, not plumbing.
- **Reduced cognitive load**: single-line exit messages vs. multi-panel summaries for routine runs.
- **Read-only replay**: finished sessions are inspectable at leisure, not just viewable while streaming.

## Impact

- **CLI users**: immediately benefit from reduced noise and the re-open workflow.
- **TUI package**: `executiontui` is now replay-capable; `Config` carries `SessionID` for session-aware rendering.
- **`list` command**: extended to a third resource family (`sessions`) alongside `executions` and `agents`.
- **`run` command**: argument signature expanded; existing two-argument invocations are fully backward-compatible.

## Related Work

- [2026-02-14: Streaming-First CLI Execution](2026-02-14-125037-streaming-first-cli-execution.md)
- [2026-02-14: CLI Bubbletea Execution Viewer](2026-02-14-220416-cli-bubbletea-execution-viewer.md)
- [2026-02-14: CLI Rich Approval Experience](2026-02-14-131747-cli-rich-approval-experience.md)
- [2026-02-15: TUI Scroll Navigation](2026-02-15-120409-cli-tui-scroll-navigation.md)
- [2026-02-15: TUI Help/Status Polish](2026-02-15-125337-cli-tui-help-status-polish.md)
- [2026-02-15: Session-Scoped Local Workspace Directories](2026-02-15-193226-session-scoped-local-workspace-directories.md)

---

**Status**: ✅ Production Ready  
**Timeline**: Single session implementation across ~18 files (6 new, 12 modified)
