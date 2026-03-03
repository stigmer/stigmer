# Next Task: 20260303.02.cli-tui-ux-hardening

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260303.02.cli-tui-ux-hardening

**Description**: Comprehensive hardening of the Stigmer CLI/TUI execution pipeline — fixing approval flow gaps, error handling, stream resilience, terminal degradation, stdout/stderr discipline, and UX polish across the draft, run, and discover commands.
**Goal**: Eliminate all identified UX gaps in the CLI/TUI so that every user interaction is resilient, informative, and recoverable — zero leaked errors, zero silent hangs, zero broken terminal states.
**Tech Stack**: Go, Bubbletea (charmbracelet), gRPC, Cobra
**Components**: client-apps/cli/cmd/stigmer/root (run, draft, discover commands), client-apps/cli/pkg/executiontui (TUI model, events, approval, blocks), client-apps/cli/internal/cli/clierr (error handling), client-apps/cli/pkg/approval (approval prompts)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.02.cli-tui-ux-hardening/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Gap Analysis Source

The full gap analysis was conducted in a prior conversation. 17 gaps were identified
across 4 severity levels (Critical, High, Medium, Low). The detailed plan with
per-gap fixes is in `tasks/T01_0_plan.md`.

Related issue file: `_cursor/issues/tui-resume-flow-approval-not-surfaced.md`
Role reference: `_roles/003_cli_tui_ux_eng`

## Current State

- **Status**: in-progress
- **Last Session**: 2026-03-03 (Session 4) — Phase 1.5 implementation complete
- **Active Task**: None — ready to pick Phase 1.4 (last Critical item)

## Session Progress (2026-03-03 — Session 4)

- Completed Phase 1.5: Esc as Cancel Shortcut
- Added Esc as alternative cancel trigger in `handleKeyPress` — single condition expansion, no new model state
- Updated footer hints (4 locations) from `c cancel` to `Esc/c cancel`
- Updated help panel Execution Control binding from `c` to `Esc / c`
- Added `newTestModelWithCancel` test helper and 7 new unit tests covering all Esc interaction states
- All tests passing alongside existing suite
- Created changelog: `_changelog/2026-03/2026-03-03-212159-esc-as-cancel-shortcut.md`

## Session Progress (2026-03-03 — Session 3)

- Completed Phase 1.3: Dead Stream Connection Detection (revised scope)
- Challenged all three original plan components — keepalive already existed, recv timeout and stale warning were proven anti-patterns
- Added `classifyStreamError` — translates raw gRPC/io errors into actionable user messages with re-attach instructions
- Added `streamError` type with idiomatic Go error wrapping (`Error()` for display, `Unwrap()` for diagnostics)
- Threaded `sessionID` into `streamToEventsConfig` for re-attach instructions
- Improved TUI `StreamErrorEvent` rendering — removed "Stream error:" prefix, added follow-up reconnection hint
- Fixed pre-existing flaky test (`select` non-determinism with buffered channel)
- Wrote 10 new unit tests — all passing alongside existing suite
- Created changelog: `_changelog/2026-03/2026-03-03-211329-actionable-stream-error-messages.md`

## Session Progress (2026-03-03 — Session 2)

- Completed Phase 1.2: Context-Cancellable Approval Flow
- Challenged the original plan's "deadlock" diagnosis — identified it as a goroutine lifecycle management failure
- Rejected buffer increase (16 → 64) and 30s approval timeout as wrong fixes
- Added `trySendEvent` reusable helper for context-aware channel sends
- Made `emitAndWaitApproval` cancellable with `select` + `ctx.Done()` on all channel ops
- Applied cancellable context pattern to `streamAgentExecution`, `resumeSession`, and `buildFollowUpFn`
- Migrated error/phase/done sends in `streamToEvents` to use `trySendEvent`
- Wrote 6 new unit tests — all passing alongside existing suite
- Created changelog: `_changelog/2026-03/2026-03-03-205941-context-cancellable-approval-flow.md`

## Session Progress (2026-03-03 — Session 1)

- Completed Phase 1.1: Defense-in-depth fix for approval prompts on resume
- Discovered and corrected an architectural misdirection: plan targeted snapshot path, but the fix belongs on the stream path
- Added `findAllUnpromptedApprovals` with sub-agent awareness to `run_stream_approval.go`
- Added Step 3b fallback block in `streamToEvents` in `run_stream_events.go`
- Wrote 6 unit tests — all passing
- Created changelog: `_changelog/2026-03/2026-03-03-204258-fix-approval-not-surfaced-on-resume.md`

## Next Steps

1. **Phase 1.4**: Emergency Terminal Restore on Crash — the **last remaining Phase 1 (Critical) item**
   - Register `defer` recovery handler around `tea.NewProgram().Run()` for panic recovery
   - Register signal handlers for SIGTERM/SIGHUP for graceful alt-screen teardown
   - Add `stigmer reset-terminal` escape hatch command
   - Files: `run_stream.go`, `run_session.go`, new `reset_terminal.go`
2. After Phase 1.4, **Phase 1 is fully complete** — move to Phase 2 (High — Error Handling, Progress & Output Modes)

## Context for Resume

- **Phase 1.5 key pattern**: Esc maps to the same cancel-confirm flow as `c` via `msg.Type == tea.KeyEsc` in `handleKeyPress`. No new model fields — reuses existing `cancelConfirm` and `handleCancelConfirmKey`.
- **Phase 1.3 key pattern**: `classifyStreamError(err, sessionID)` returns a `*streamError` where `Error()` is the user-facing message and `Unwrap()` preserves the raw error. This replaces raw `errors.Wrap()` at the `stream.Recv()` error site.
- **Keepalive is already configured** at 30s/10s in `internal/cli/backend/client.go`. Do NOT add application-level recv timeouts — they were already tried and removed (falsely triggered during LLM thinking).
- **`trySendEvent` migration was decided against** for helper functions. They run inside the recv loop, bounded by the cancellable stream context. Over-engineering for near-zero probability.
- The Phase 1.1 fix targets the **stream path** (`run_stream_events.go`), NOT the snapshot path.
- The backend has a known write-ordering issue between MongoDB and Redis that can cause `pending_approvals` to be empty in the initial Subscribe snapshot. This is tracked as a backend follow-up.

## Completed Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1.1 | Approval Not Surfaced on Resume | Done (code + tests, manual test pending) |
| 1.2 | Context-Cancellable Approval Flow | Done (code + 6 tests) |
| 1.3 | Dead Stream Connection Detection | Done (code + 10 tests) |
| 1.5 | Esc as Cancel Shortcut | Done (code + 7 tests) |

## Blockers

- None. Phase 1.1 manual test requires running backend environment.

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260303.02.cli-tui-ux-hardening/next-task.md`

## Quick Commands

After loading context:
- "Continue with the next phase" - Pick the next task from the plan
- "Show project status" - Get overview of progress
- "Run manual test" - Follow manual test instructions for Phase 1.1

---

*This file provides direct paths to all project resources for quick context loading.*
