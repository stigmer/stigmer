# Next Task: 20260303.01.fix-oss-org-scoping

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260303.01.fix-oss-org-scoping  
**Description**: Fix missing org scoping in OSS server pipeline steps. Slug lookups in LoadForApply, LoadExisting, CheckDuplicate, and FindResourceBySlug match globally across orgs instead of being org-scoped. This causes the seedpack bootstrap to silently update agents under the wrong org (local instead of default) and breaks multi-org resource isolation.  
**Goal**: Add org filtering to all shared pipeline steps (findBySlug, FindResourceBySlug, duplicate check) and ID-based lookups to enforce org-scoped resource isolation in the OSS backend. Directly unblocks the seedpack bootstrap under org default.  
**Tech Stack**: Go/gRPC  
**Components**: backend/libs/go/grpc/request/pipeline/steps/, backend/libs/go/store/, backend/services/stigmer-server/pkg/domain/skill/controller/push.go

**Created**: 2026-03-03  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.01.fix-oss-org-scoping
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.01.fix-oss-org-scoping/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.01.fix-oss-org-scoping/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260303.01.fix-oss-org-scoping/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-03-03  
**Current Focus**: All tasks complete  
**Phase**: Done

## Session Progress (2026-03-03)

### Completed
- **Task 1**: Fixed `FindResourceBySlug` shared helper in `helpers.go`
  - Added `org string` parameter to enforce org-scoped slug lookups
  - Applied same org filter guard as the reference implementation in `LoadByReferenceStep`
  - Updated the single caller in `push.go` to pass `skill.Metadata.Org`
  - Build verified clean

- **Task 2**: Fixed `LoadForApplyStep.findBySlug` — ROOT CAUSE of bootstrap bug
  - Deleted private `findBySlug` method, consolidated into shared `FindResourceBySlug[T]`
  - Added org-scoped lookup via `metadata.Org`
  - Upgraded `FindResourceBySlug` return type from `(T, error)` to `(T, bool, error)` — Go generics does not allow `T == nil`, so an explicit `found` bool was required
  - Updated caller in `push.go` to use new signature
  - All 9 workspace modules build cleanly
  - Net ~25 lines removed from load_for_apply.go

- **Task 3**: Fixed `LoadExistingStep.findBySlug` — org-scoped Update/Delete slug fallback
  - Same consolidation pattern as Task 2: deleted private `findBySlug`, delegated to shared `FindResourceBySlug[T]`
  - Eliminated `found.(T)` type assertion — shared helper returns `T` directly
  - Removed unused imports (`"context"`, `apiresourcekind`)
  - Fixed inaccurate doc comment (said "Apply operations" — corrected to Update/Delete)
  - Net ~30 lines removed
  - Build verified clean

- **Task 4**: Fixed `CheckDuplicateStep.findBySlug` — org-scoped duplicate check
  - Replaced private `findBySlug` with shared `FindResourceBySlug[T]`; extracted `org := metadata.Org` and passed to helper
  - Duplicate check now scoped to same org (same slug allowed in different orgs)
  - Removed unused imports (`"context"`, `apiresourcekind`); updated struct and Execute doc comments
  - Error message now includes org: `already exists in org '%s' (id: %s)`
  - Net ~33 lines removed from duplicate.go; all workspace modules build cleanly

- **Task 5**: N/A — cloud comparison showed ID-based lookups intentionally do not verify org in generic pipeline steps. Cloud relies on FGA for access control. OSS is now aligned with cloud pattern after Tasks 1–4.

- **Task 6**: Added comprehensive org-scoping tests for all fixed pipeline steps
  - Created `helpers_test.go` with 6 direct unit tests for `FindResourceBySlug`
  - Added `TestLoadForApplyStep_OrgScoping` (2 subtests) — the bootstrap bug scenario
  - Added `TestLoadExistingStep_SlugFallback` (3 subtests) — filled zero-coverage gap on slug fallback path
  - Added `TestCheckDuplicateStep_OrgScoping` (3 subtests) — org-scoped duplicate check
  - Updated 2 existing tests to include `Org` in test data
  - All 63 tests pass, build clean

### Context for Resume
- **Key gotcha**: Go generics does not allow `T == nil` on type parameters constrained to interfaces. Use the `found` bool from `FindResourceBySlug` instead of nil-checking the returned value.
- **Cloud alignment**: ID-based lookups (Get/Delete/Update-by-ID) do not verify org — matches cloud pattern. Only slug-based lookups are org-scoped.
- **Testing gotcha**: `NewRequestContext` clones input via `proto.Clone()`. Assertions on fields set by pipeline steps must use `reqCtx.NewState()`, not the original input pointer.

---

## Root Cause (from audit)

After the org-tenancy migration, system agents created under org `local` are unreachable
because the CLI now resolves to org `default`. The seedpack bootstrap re-applies agents with
`metadata.org: default`, but the server's `LoadForApply.findBySlug` matches the existing
`local/skill-creator` by slug globally (no org filter), routes to UPDATE, and
`BuildUpdateState` preserves `org: local` as immutable. The agent stays under `local`.

## Reference Implementation (Correct)

`load_by_reference.go` (`LoadByReferenceStep.findBySlug`) is the ONLY step that correctly
filters by org:

```go
if metadata.Slug == slug {
    if org != "" && metadata.Org != org {
        continue
    }
    return resource, true, nil
}
```

All other slug lookups need this same guard.

## Files to Modify

### Tier 1 — Shared Pipeline Steps (HIGH priority, fixes cascade to all domains)

All in `backend/libs/go/grpc/request/pipeline/steps/`:

| File | Function | Status |
|------|----------|--------|
| `helpers.go` | `FindResourceBySlug` | Fixed (Task 1) — org param added |
| `load_for_apply.go` | `findBySlug` | Fixed (Task 2) — consolidated to shared helper with org |
| `load_existing.go` | `findBySlug` | Fixed (Task 3) — consolidated to shared helper with org |
| `duplicate.go` | `findBySlug` | Fixed (Task 4) — consolidated to shared helper with org |
| `load_existing.go` | `Execute` (ID path) | N/A (Task 5) — matches cloud pattern |
| `load_target.go` | `Execute` | N/A (Task 5) — matches cloud pattern |
| `delete.go` | `LoadExistingForDeleteStep.Execute` | N/A (Task 5) — matches cloud pattern |

### Tier 2 — Callers of shared helper

| File | Caller |
|------|--------|
| `backend/services/stigmer-server/pkg/domain/skill/controller/push.go:206` | `FindResourceBySlug` without org |

## Key Design Decisions

- Slugs are **org-scoped**, not globally unique (same slug CAN exist in different orgs)
- `metadata.Org` is immutable on UPDATE (preserved from existing resource)
- Org filter uses: `if org != "" && metadata.Org != org { continue }` (empty org = no filter)
- Store interface `ListResources(ctx, kind)` has no org param — filtering is in-memory (fine for OSS scale)

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

