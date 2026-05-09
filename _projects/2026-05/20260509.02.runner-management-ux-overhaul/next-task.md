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
**Current Task**: T07 — End-to-end testing
**Status**: NOT STARTED

## Next Steps

1. **T07**: End-to-end testing — verify the full auto-ensure lifecycle from first-run prompt through active runner to disable
2. Polish pass — review all T01-T06 work for consistency, token compliance, accessibility

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-05/20260509.02.runner-management-ux-overhaul/next-task.md`

## Session Progress (2026-05-09, session 6)

- Completed T06 Phase 5: Fleet view polish — sorting, filtering, empty states across SDK and Desktop
- **SDK `shared.tsx`** (new): Extracted `RunnerIcon`, `PhaseBadge`, `formatRelativeTime` into a shared module, eliminating triple duplication across `RunnerListPanel`, `OrgFleetSection`, and `ThisMachineCard`
- **SDK `RunnerListPanel`**: Replaced custom inline empty/error JSX with shared `EmptyState` component (`first-use`, `zero-results`, `error` variants). Added optional `filterPhases`, `searchQuery`, `sortBy`, `sortDirection` props with backward-compatible defaults. New `buildComparator` supports sorting by phase, name, heartbeat, or executions.
- **SDK exports**: New public API: `RunnerSortKey`, `RunnerIcon`, `RunnerIconProps`, `PhaseBadge`, `PhaseBadgeProps`, `formatRelativeTime`
- **Desktop `OrgFleetSection`**: Major polish — fleet summary line ("X of Y active"), toggleable phase filter chips with per-phase counts, debounced name/hostname search (shown when fleet > 5), compact sort dropdown (phase/name/heartbeat/executions), proper empty states (first-use + zero-results with "Clear filters" action)
- **Desktop `ThisMachineCard`**: Deduped — imports `formatRelativeTime` from SDK instead of local copy, removed unused `useCallback` import
- Both `tsc --noEmit` passes (SDK and Desktop) compile clean, zero errors

### Key design decisions: session 6

- **Lightweight filter over ResourceWorkbench**: Runner fleet is a monitoring view for ~5-20 items. Phase chips + search + sort dropdown is proportional to the data model (Hick's Law). Full workbench deferred until runner counts meaningfully grow.
- **Section heading persists when empty**: "Organization Runners" heading stays visible with an `EmptyState` inside — disappearing headings are disorienting (Nielsen heuristic #1).
- **Search threshold at 5 runners**: Search input only appears for fleets with >5 runners to avoid UI clutter for solo developers.
- **Shared utilities over copy-paste**: `formatRelativeTime`, `PhaseBadge`, `RunnerIcon` extracted to `sdk/react/src/runner/shared.tsx` and exported from `@stigmer/react` — Desktop imports instead of maintaining local copies.

## Session Progress (2026-05-09, session 5)

- Completed T05 Phase 4: Desktop UI redesign — status card replaces Start Runner modal
- **Rust layer**: New `query_runner_socket` and `stop_runner_via_socket` Tauri commands (HTTP/1.1 over Unix socket, 2s timeout, disk-state fallback)
- **Rust layer**: New `preferences.rs` module with `get_runner_preference` / `set_runner_preference` (persisted to `~/.stigmer/desktop/preferences.json`)
- **Updated `RunnerStateFile`** to include T03/T04 fields: `machine_id`, `socket_path`, `runtime`
- **TypeScript IPC**: 4 new typed invoke wrappers in `tauri.ts` (`invokeQueryRunnerSocket`, `invokeStopRunnerViaSocket`, `invokeGetRunnerPreference`, `invokeSetRunnerPreference`)
- **New hooks**: `useLocalRunnerStatus` (socket-polling with adaptive intervals), `useAutoEnsure` (lifecycle state machine with preference persistence)
- **New UI components**: `ThisMachineCard` (5-state status card), `FirstRunPrompt` (one-time opt-in), `OrgFleetSection` (fleet list with topology)
- **RunnersPage rewritten**: 917-line monolith decomposed into 5 focused files. StartRunnerDialog deleted.
- Both Rust (`cargo check`) and TypeScript (`tsc --noEmit`) compile clean, no linter errors

### Key design decisions: session 5

- **Minimal HTTP client over Unix socket**: Hand-rolled HTTP/1.1 request/response over `tokio::net::UnixStream` instead of adding `hyper`/`hyperlocal` — two trivial endpoints don't justify a heavy dependency.
- **File-based preferences over tauri-plugin-store**: Two booleans (`enabled`, `prompted`) stored as plain JSON at `~/.stigmer/desktop/preferences.json`. No plugin dependency for a trivial persistence need.
- **Callback-based ensure**: `useAutoEnsure` accepts an `onEnsure` callback rather than building credentials internally — keeps credential management in the page component where auth context is available.
- **Socket-first, disk-fallback, server-merge**: `query_runner_socket` tries Unix socket for live status, falls back to disk state files, and the UI merges with server-side `Runner` resource for execution count and phase. Socket = truth for local liveness, server = truth for backend awareness.
- **First-run opt-in then auto-enabled**: New users see an inline prompt on first visit. After consent, runner auto-ensures on Desktop launch + sign-in. Preference survives browser cache clears.
- **Split-view page**: "This Machine" card at top (primary), "Organization Runners" list below (secondary, this-machine deduplicated).
- **StartRunnerDialog removed**: Custom name/endpoint/token fields are power-user concerns served by `stigmer up` CLI. Desktop auto-ensures with session credentials and hostname defaults.

## Session Progress (2026-05-09, session 4)

- Implemented HTTP-over-Unix-socket control server (`controlsock` sub-package)
- Server exposes `GET /status` and `POST /stop` on `~/.stigmer/run/runner.sock`
- Client provides `Ping()`, `Stop()`, `IsHealthy()` with 2s timeout
- Added `MigrateStateLayout()` to rename state files from hostname-slug to machine_id keys
- Enhanced `isRunnerAlive()` to prefer socket health check over PID probing (PID fallback preserved)
- Enhanced `stopNativeRunner()` to use socket-based graceful stop before SIGTERM fallback
- Added `SocketPath` to `RunnerState` and `EnsureResult`
- Wired socket server lifecycle into `startNativeRunner()` with channel-based stop signal
- 67 tests pass (52 runner + 15 controlsock), full CLI binary builds clean

### Key design decisions: session 4

- **HTTP over Unix socket**: Docker/containerd pattern. Native Go `net/http`, debuggable with `curl --unix-socket`.
- **Short flat socket path**: Research report's deep nested path would exceed macOS 104-byte `sun_path` limit. `~/.stigmer/run/runner.sock` is ~35 chars.
- **Minimal RPC scope**: Only `GET /status` and `POST /stop`. Restart/pause/resume/logs deferred to future phases.
- **Copy-then-remove migration**: `MigrateStateLayout` writes new file first, removes old only on success.
- **Socket-preferred, PID-fallback liveness**: Backward compatible with pre-T04 runners.
- **Desktop integration deferred to T05**: CLI-only in T04 to validate pattern before Desktop consumes it.

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
| T04 | Phase 3: Local control socket | COMPLETE |
| T05 | Phase 4: Desktop UI redesign (status card) | COMPLETE |
| T06 | Phase 5: Fleet view polish | COMPLETE |
| T07 | Phase 6: End-to-end testing | Not started |

## Quick Commands

After loading context:
- "Continue with T03" - Start stable machine_id identity
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
