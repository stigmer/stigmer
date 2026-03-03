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

**Status**: ⏸️ TODO
**Created**: 2026-03-03 06:53

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

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

