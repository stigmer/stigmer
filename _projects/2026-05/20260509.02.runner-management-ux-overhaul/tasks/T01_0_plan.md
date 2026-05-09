# Task T01: Phase 0 — Immediate UX Fix (Already Running = Success)

**Created**: 2026-05-09 19:42
**Status**: PENDING REVIEW
**Type**: Feature Development
**Research**: `_projects/2026-05/research.runner-management-ux/04.report.gpt.md`

⚠️ **This plan requires your review before execution**

## Objective

Fix the immediate user-facing bug: clicking "Start Runner" in the Desktop app when a runner is already active shows a red error instead of treating it as success. This phase requires **no architecture changes** — it maps the existing "already running" error to a success state in both the CLI and Desktop.

## Problem Statement

Current behavior:
1. User clicks "Start Runner" with empty fields
2. CLI returns error: `runner "swarups-macbook-pro-local" is already running`
3. Desktop shows this as a red error banner
4. User is confused — their intent ("use this computer") is already satisfied

Target behavior:
1. User clicks "Start Runner" (or Desktop auto-ensures on launch)
2. System detects existing runner, verifies it's healthy
3. Desktop shows: "This computer is already connected"
4. No error, no `--name` suggestion

## Implementation Plan

### 1. CLI Change: `stigmer up runner` treats same-runner-active as exit 0

**File**: `client-apps/cli/internal/cli/runner/start.go`

Change `checkNameConflict()` behavior:
- Currently returns `fmt.Errorf(...)` unconditionally when runner is alive
- New behavior: if `--adopt` flag is set (or called via `--standalone` from Desktop), print a success message and return a **structured exit** indicating adoption
- For interactive CLI: print info-level message ("Runner already active: ...") and exit 0
- Only error if: different org, different endpoint, unresponsive process, or explicit `--new` flag used

Specifically:
```go
// When runner is already running for the same org/endpoint:
// - Print success message (not error)
// - Exit 0
// - Structured JSON output for Desktop consumption

// Only error when:
// - Process exists but is unresponsive (health check fails)
// - Runner belongs to different org (when org is specified and mismatches)
// - User explicitly requested --new and name conflicts
```

### 2. CLI structured output for Desktop consumption

**File**: `client-apps/cli/internal/cli/runner/start.go`

When `--standalone --json` is passed (Desktop mode), output structured JSON on adoption:
```json
{
  "status": "adopted",
  "runner_id": "rnr_...",
  "name": "swarups-macbook-pro-local",
  "pid": 9730,
  "backend_endpoint": "api.stigmer.ai:443",
  "task_queue": "runner:rnr_...",
  "started_at": "2026-05-09T06:12:00Z"
}
```

Exit code: 0

### 3. Desktop Tauri sidecar: detect adoption vs fresh start

**File**: `client-apps/desktop/src-tauri/src/sidecar.rs`

In the `start_runner` command:
- After CLI exits 0 during grace period: check if output contains adoption JSON
- If adopted: emit `runner:started` (or new `runner:adopted`) event with runner info
- Load local state from `~/.stigmer/runners/<name>.json`
- Register in ProcessManager as adopted (not as child process — we don't own it)

### 4. Desktop UI: handle adoption gracefully

**File**: `client-apps/desktop/src/pages/runners/RunnersPage.tsx`

In `handleStart`:
- On success from `startRunner`: if adopted, close dialog and show success toast "Connected to existing runner"
- Do NOT show error banner for adoption case

**File**: `client-apps/desktop/src/pages/runners/StartRunnerDialog.tsx`
- No changes needed (dialog closes on success)

### 5. Desktop fallback: parse existing error as adoption

As an interim measure (before CLI changes ship), the Desktop can also detect the specific error pattern:
```
runner "<name>" is already running
```
and treat it as a soft success by:
1. Loading `~/.stigmer/runners/<name>.json`
2. Verifying PID is alive
3. Verifying org/endpoint match the current Desktop session
4. Closing the dialog with a success message instead of showing the error

**File**: `client-apps/desktop/src-tauri/src/sidecar.rs` (in the early_exit error handling)

## Files to Modify

| File | Change |
|------|--------|
| `client-apps/cli/internal/cli/runner/start.go` | `checkNameConflict` returns success (not error) for same-org same-endpoint active runner |
| `client-apps/desktop/src-tauri/src/sidecar.rs` | Parse "already running" as adoption; load state and emit success |
| `client-apps/desktop/src/pages/runners/RunnersPage.tsx` | Handle adoption event; remove `--name` suggestion from error display |

## Testing

- [ ] `stigmer up runner` when runner already running → prints info, exits 0
- [ ] `stigmer up runner --new` when name conflicts → errors as before (explicit multi-runner)
- [ ] Desktop "Start Runner" when runner active → shows "Connected to existing runner"
- [ ] Desktop "Start Runner" when runner active for DIFFERENT org → shows clear conflict message
- [ ] Desktop "Start Runner" when stale PID → cleans up and starts fresh (existing behavior preserved)

## Success Criteria

- The exact screenshot scenario (PID 9730 already running) results in a success message, not a red error
- CLI exits 0 for same-runner-active case
- Desktop auto-adopts without user confusion
- No breaking changes for users who intentionally run multiple named runners

## Non-Goals for T01

- No `machine_id` yet (Phase 2)
- No control socket (Phase 3)
- No UI redesign of the Runners page (Phase 4)
- No service install (Phase 5)
- No server-side RunnerSession model (Phase 6)

---

## Project Task Overview (All Phases)

| Task | Phase | Description |
|------|-------|-------------|
| **T01** | Phase 0 | Immediate UX fix: already running = success |
| T02 | Phase 1 | Idempotent `stigmer runner ensure --json` command |
| T03 | Phase 2 | Stable `machine_id` identity (replaces hostname-slug) |
| T04 | Phase 3 | Local control socket for cross-process adoption |
| T05 | Phase 4 | Desktop UI redesign: status card replaces Start Runner modal |
| T06 | Phase 5 | Service/login integration (LaunchAgent / systemd --user) |
| T07 | Phase 6 | Server-side RunnerSession model + structured ALREADY_CONNECTED |

---

## Review Process

**What happens next**:
1. **You review this plan** — does the Phase 0 approach make sense?
2. **Provide feedback** — any concerns about exit code changes, Desktop fallback strategy, etc.
3. **I'll revise if needed** — then proceed to implementation
4. **After T01 ships** — we move to T02 (idempotent ensure command)
