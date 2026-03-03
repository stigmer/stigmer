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

**Last Updated**: 2026-03-03 07:16  
**Current Focus**: Task 3 — Fix `LoadExistingStep.findBySlug`  
**Phase**: Implementation

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

### Next Steps
1. **Task 3**: Fix `LoadExistingStep.findBySlug` — add org filter for Update/Delete slug fallback
2. **Task 4**: Fix `CheckDuplicateStep.findBySlug` — add org filter for cross-org slug reuse
3. **Task 5**: Fix ID-based lookups — add org verification after load (3 steps)
4. **Task 6**: Tests

### Context for Resume
- **Pattern established in Task 2**: Tasks 3 and 4 should follow the same consolidation approach — delete the private `findBySlug` method and delegate to the shared `FindResourceBySlug[T]` helper. The helper already has org filtering and returns `(T, bool, error)`.
- The org value comes from `metadata.Org` on `ctx.NewState()` (the resource being applied/created/updated)
- Task 5 is different: ID-based lookups need post-load org verification, not slug filtering
- **Key gotcha**: Go generics does not allow `T == nil` on type parameters constrained to interfaces. Use the `found` bool from `FindResourceBySlug` instead of nil-checking the returned value.

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

| File | Function | Gap |
|------|----------|-----|
| `helpers.go` | `FindResourceBySlug` | No org param at all (exported API) |
| `load_for_apply.go` | `findBySlug` | Slug matches globally — ROOT CAUSE of bootstrap bug |
| `load_existing.go` | `findBySlug` | Slug fallback matches across orgs |
| `duplicate.go` | `findBySlug` | Prevents same slug in different orgs |
| `load_existing.go` | `Execute` (ID path) | No org verify after load |
| `load_target.go` | `Execute` | No org verify after load |
| `delete.go` | `LoadExistingForDeleteStep.Execute` | No org verify after load |

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

