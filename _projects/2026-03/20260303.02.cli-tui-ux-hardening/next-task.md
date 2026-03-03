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
- **Last Session**: 2026-03-03 — Phase 1.1 implementation complete
- **Active Task**: Phase 1.1 "Approval Not Surfaced on Resume" (code + tests done; manual test pending)

## Session Progress (2026-03-03)

- Completed Phase 1.1 defense-in-depth fix for approval prompts on resume
- Discovered and corrected an architectural misdirection: plan targeted snapshot path, but the fix belongs on the stream path
- Added `findAllUnpromptedApprovals` with sub-agent awareness to `run_stream_approval.go`
- Added Step 3b fallback block in `streamToEvents` in `run_stream_events.go`
- Wrote 6 unit tests — all passing
- Created changelog: `_changelog/2026-03/2026-03-03-204258-fix-approval-not-surfaced-on-resume.md`

## Next Steps

1. **Manual test**: Detach during an approval, re-attach via `stigmer run ses-XXX`, verify the approval prompt appears
2. Pick the next phase from the plan in `tasks/T01_0_plan.md` (likely Phase 1.2 or another Phase 1 item)
3. Continue through the CLI/TUI UX hardening plan

## Context for Resume

- The fix targets the **stream path** (`run_stream_events.go`), NOT the snapshot path. The snapshot path only handles terminal executions and lacks gRPC approval response plumbing.
- The defense-in-depth block only fires when `pending_approvals` is empty AND the execution phase is `WAITING_FOR_APPROVAL`. It does not replace the primary path.
- The backend has a known write-ordering issue between MongoDB and Redis that can cause `pending_approvals` to be empty in the initial Subscribe snapshot. This is tracked as a backend follow-up.

## Blockers

- None. Manual test requires running backend environment.

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
