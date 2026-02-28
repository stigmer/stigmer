# Next Task: e2e-declarative-workspace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260228.02.e2e-declarative-workspace

**Description**: End-to-end verification, documentation, and enhancement of the declarative track, workspace provisioning, and platform file isolation projects.

**Goal**: Ensure the entire flow works (server bootstrap → draft → apply → run → workspace provisioning → file isolation), document it for customers, and fix the seedpack flow.

## Current Status

**Last Session**: 2026-02-28 (Session 2) — T03 complete: seedpack root move + CLI bootstrap migration
**Active Task**: Ready for T04 (Add --workspace flag to CLI)

| Task | Status | Description |
|------|--------|-------------|
| T01 | ✅ DONE | Architecture review — 13 gaps identified, all three projects verified on main |
| T02 | ✅ DONE | Declarative track enhanced — skill dirs + subdirectory scanning |
| T03 | ✅ DONE | Seedpack migration — moved to root, gutted to thin wrapper, CLI-driven bootstrap, ~1,100 lines deleted |
| T04 | 🎯 NEXT | Add `--workspace` flag to CLI — wire workspace provisioning end-to-end |
| T05 | PENDING | End-to-end testing — 8 scenarios covering full flow |
| T06 | PENDING | Customer documentation — getting started guide, reference docs |

## Session Progress (2026-02-28, Session 2)

### Major Accomplishments
- ✅ **T03 Complete**: Full seedpack migration executed
  - Moved seedpack from `backend/services/stigmer-server/pkg/seedpack/` to `seedpack/` at repo root
  - Gutted `seedpack.go` from 660 lines to 80 lines (ExtractToDir + ContentHash only)
  - Deleted `bootstrap.go` (428 lines), `bootstrap_test.go`, and `BUILD.bazel` entirely
  - Migrated bootstrap to CLI subprocess in `daemon.EnsureRunning()`
  - Enhanced scanner for nested skill layouts (`skills/{name}/SKILL.md`)
  - Created new Go module `github.com/stigmer/stigmer/seedpack`
  - Added `stigmer.yaml` project manifest, 2 new tool scripts

### Key Decisions Made
- DD-01 overturned: seedpack moved to repo root (own Go module resolves embed constraint)
- CLI-only bootstrap: server's internal bootstrap completely removed
- Search index rebuild preserved at server startup, decoupled from bootstrap
- Recursion guard via `STIGMER_SKIP_SEEDPACK_BOOTSTRAP` env var
- Flag file `$dataDir/.seedpack-bootstrapped` for idempotency

### Open Discussion
- User raised concern about Go files (seedpack.go, embed.go, go.mod) being misleading alongside content files — potential restructuring into `seedpack/content/` subdirectory

## Next Steps

1. **T04**: Add `--workspace` flag to CLI — wire workspace provisioning end-to-end
2. **T05**: End-to-end testing — 8 scenarios covering full flow
3. **T06**: Customer documentation — getting started guide, reference docs

## Context for Resume

### What T03 Achieved
The seedpack is now a proper first-class citizen:
- **Visible**: At repo root, not hidden 5 levels deep in backend
- **Proper project**: Has `stigmer.yaml`, can be applied with `stigmer apply`
- **Single code path**: System resources applied through same `stigmer apply` as user resources
- **CLI-driven bootstrap**: `daemon.EnsureRunning()` spawns `stigmer apply` subprocess after server starts
- **~800 lines net deletion**: Simpler codebase, no duplicated logic

### Why T04 is Next
T04 wires workspace provisioning into the CLI so users can run agents with isolated workspaces via `stigmer agent run --workspace`. This is the next piece of the end-to-end flow.

## Essential Files

### Task Plans
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T03_0_plan.md` — Seedpack as project (original plan)
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T04_0_plan.md` — Workspace CLI flag
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T05_0_plan.md` — E2E testing
- `_projects/2026-02/20260228.02.e2e-declarative-workspace/tasks/T06_0_plan.md` — Documentation

### Checkpoints
- `checkpoints/CP01_initial_review_and_t02.md` — Session 1 (T01+T02)
- `checkpoints/2026-02-28-session-2.md` — Session 2 (T03)

### Design Decisions
- `design-decisions/DD01_seedpack_location.md` — Originally keep nested, overturned to move to root
- `design-decisions/DD02_declarative_skill_support.md`

### Key Code Files
- `seedpack/` — Seedpack at repo root (migrated in T03)
- `client-apps/cli/internal/cli/daemon/daemon.go` — CLI-driven bootstrap (added in T03)
- `client-apps/cli/cmd/stigmer/root/apply_declarative.go` — Declarative track (enhanced in T02+T03)
- `client-apps/cli/cmd/stigmer/root/run.go` — Run command (target for T04)

### Execution Plan
- `.cursor/plans/t03_full_seedpack_migration_a996bc18.plan.md` — Detailed T03 execution plan

## Quick Commands

- "Continue with T04" — Start workspace CLI flag
- "Continue with T05" — Start end-to-end testing
- "Show project status" — Get overview of progress

---

*Drop this file into chat to resume. Start by reading the latest checkpoint.*
