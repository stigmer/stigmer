# Next Task: 20260509.02.runner-management-ux-overhaul

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260509.02.runner-management-ux-overhaul

**Description**: Overhaul runner management UX to make local execution invisible and idempotent. Replace the 'Start Runner' modal with a reconciled desired-state model where the desktop app auto-adopts existing runners, treats 'already running' as success, and exposes status rather than process-creation forms.
**Goal**: Make runner lifecycle invisible to desktop users. A user should never see 'runner already running' as an error. The target UX is: when Stigmer Desktop is open and the user is signed in, this computer is available for Stigmer runs unless the user disables it.
**Tech Stack**: Go CLI, TypeScript/React desktop (Tauri), Rust sidecar, Proto/gRPC backend (Java), systemd/launchd
**Components**: client-apps/cli (runner package), client-apps/desktop (RunnersPage, StartRunnerDialog, Tauri sidecar), sdk/react (runner hooks), backend runner service (stigmer-cloud), proto definitions (runner/v1)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260509.02.runner-management-ux-overhaul/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-09 19:42
**Current Task**: T03 — Phase 2: Stable machine_id identity
**Status**: COMPLETE — committed as `90eabd4db`

## Session Progress (2026-05-09, session 3)

- Implemented stable `machine_id` identity (`~/.stigmer/machine.json`)
- Added `machine_id` field to `RunnerConnectionInfo` proto (field 5)
- Updated `checkOrAdopt` with machine_id fallback scan for hostname-change adoption
- Wired machine_id into heartbeat stream, `EnsureResult`, and `RunnerState`
- Wrote 11 new tests (47 total pass in runner package)
- All checks pass: `go build`, `go vet`, `go test`, `buf lint`
- Committed as `90eabd4db`

### Key design decisions: session 3

- **crypto/rand over ULID**: No new dependency needed. Format is `mach_` + 32 hex chars (128-bit randomness). Self-describing prefix, no dashes, universally safe in paths/labels/URLs.
- **RunnerConnectionInfo over RunnerSpec**: `machine_id` is auto-generated host metadata (same category as hostname, os, arch), not user-declared desired state. Sent on every heartbeat automatically.
- **Client+proto only (server deferred to T07)**: Ship value incrementally — local adoption works now, server enforcement comes later with proper migration planning.
- **Daemon embedded runner omits machine_id**: Circular dependency prevents daemon from importing runner package. Empty string is fine (server ignores the field until T07).

## Session Progress (2026-05-09, session 2)

- Extracted `Ensure()` from `Start()` with `onReady` callback pattern
- Added `EnsureResult`/`EnsureError` typed JSON contract in new `ensure.go`
- Wired `--json` flag on `stigmer up [runner]` to write structured JSON to stdout
- Extended `stigmer status` to show standalone runners from `~/.stigmer/runners/`
- Updated Tauri sidecar to pass `--json` and parse structured output in adoption path
- Wrote 13 new unit tests (36 total pass)
- All checks pass: `go build`, `go vet`, `go test`, `cargo check`

### Key design decision: verb-first CLI preserved

The research report originally proposed a `stigmer runner ensure` noun-first command group. During planning, we decided to keep the verb-first CLI design language (`stigmer up`/`stigmer down`/`stigmer status`) and express ensure semantics through `stigmer up --json` instead. The internal `Ensure()` function exists as the programmatic API; the CLI surface stays consistent.

## Session Progress (2026-05-09, session 1)

- Implemented `checkOrAdopt` replacing `checkNameConflict` in CLI
- Fixed Tauri sidecar to handle adoption (ProcessManager + grace period)
- Added sonner toast in Desktop UI for adoption feedback
- Wrote 8 unit tests covering all adoption/conflict/continue scenarios
- All checks pass: `go build`, `go vet`, `go test`, `cargo check`, lint clean

## Research

Deep research report available at:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/research.runner-management-ux/04.report.gpt.md
```

## Phased Delivery

| Task | Phase | Status |
|------|-------|--------|
| T01 | Phase 0: Already running = success | COMPLETE |
| T02 | Phase 1: Idempotent runner with structured JSON output | COMPLETE |
| T03 | Phase 2: Stable machine_id identity | COMPLETE |
| T04 | Phase 3: Local control socket | Not started |
| T05 | Phase 4: Desktop UI redesign (status card) | Not started |
| T06 | Phase 5: Service/login integration | Not started |
| T07 | Phase 6: Server-side RunnerSession model | Not started |

## Quick Commands

After loading context:
- "Continue with T03" - Start stable machine_id identity
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
