# Tasks: 20260303.01.fix-oss-org-scoping

**Created**: 2026-03-03

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Fix FindResourceBySlug shared helper — add org parameter and update skill push caller

**Status**: ✅ DONE
**Created**: 2026-03-03 06:53
**Completed**: 2026-03-03 07:02

### Subtasks
- [x] Add `org string` parameter to `FindResourceBySlug` signature in `helpers.go`
- [x] Add org filter guard: `if org != "" && metadata.Org != org { continue }`
- [x] Update doc comment to document org-scoped semantics and usage example
- [x] Pass `skill.Metadata.Org` at the call site in `push.go`
- [x] Verify `go build ./backend/...` passes cleanly
- [x] Confirm no other callers of `FindResourceBySlug` exist (grep verified: only 1 caller)

### Notes
- Followed the exact org filter pattern from `LoadByReferenceStep.findBySlug` (reference implementation)
- Return type kept as `(T, error)` — changing to `(T, bool, error)` would be a separate refactoring concern
- No existing tests reference `FindResourceBySlug` (no `helpers_test.go`); new tests deferred to Task 6

## Task 2: Fix LoadForApplyStep.findBySlug — add org filter (root cause of bootstrap bug)

**Status**: ✅ DONE
**Created**: 2026-03-03 06:53
**Completed**: 2026-03-03

### Subtasks
- [x] Replace private `findBySlug` method with shared `FindResourceBySlug[T]` helper
- [x] Extract `org := metadata.Org` and pass to shared helper
- [x] Add `Str("org", org)` to all three `log.Debug()` calls for observability
- [x] Delete private `findBySlug` method (~30 lines removed)
- [x] Update struct doc comment to reflect org-scoped slug+org lookup
- [x] Remove unused imports (`"context"`, `apiresourcekind`)
- [x] Upgrade `FindResourceBySlug` return type from `(T, error)` to `(T, bool, error)` — aligns with `LoadByReferenceStep.findBySlug` reference pattern
- [x] Update caller in `push.go` to use `(T, bool, error)` signature
- [x] Verify all 9 workspace modules build cleanly

### Notes
- **Surprise: Go generics `T == nil` compile error** — The plan assumed nil comparison on type parameter T would work, but Go does not allow `T == nil` when T is constrained to an interface. This forced upgrading `FindResourceBySlug` from `(T, error)` to `(T, bool, error)` with an explicit `found` boolean.
- **Architectural improvement**: The `(T, bool, error)` return type correctly models three business outcomes (found / not-found / error) without relying on zero-value semantics. Matches the reference implementation in `LoadByReferenceStep.findBySlug`.
- **Code reduction**: Net ~25 lines removed from `load_for_apply.go` by delegating to shared helper instead of maintaining a private copy.
- **Task 1 note superseded**: Task 1 deferred the return type change as "a separate refactoring concern." Task 2 proved it's not separable — the `(T, error)` pattern is unusable from generic callers.

## Task 3: Fix LoadExistingStep.findBySlug — add org filter for Update/Delete slug fallback

**Status**: ⏸️ TODO
**Created**: 2026-03-03 06:53

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 4: Fix CheckDuplicateStep.findBySlug — add org filter so same slug can exist in different orgs

**Status**: ⏸️ TODO
**Created**: 2026-03-03 06:53

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 5: Fix ID-based lookups — add org verification after load in LoadExistingStep, LoadTargetStep, LoadExistingForDeleteStep

**Status**: ⏸️ TODO
**Created**: 2026-03-03 06:53

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 6: Update all existing tests and add org-scoping tests for each fixed step

**Status**: ⏸️ TODO
**Created**: 2026-03-03 06:53

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

