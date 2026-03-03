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

**Status**: ✅ DONE
**Created**: 2026-03-03 06:53
**Completed**: 2026-03-03

### Subtasks
- [x] Replace private `findBySlug` call with shared `FindResourceBySlug[T]` helper
- [x] Extract `org := metadata.Org` and pass to shared helper
- [x] Delete private `findBySlug` method (~30 lines removed)
- [x] Remove unused imports (`"context"`, `apiresourcekind`)
- [x] Fix inaccurate struct doc comment (said "Apply operations" — corrected to org-scoped Update/Delete semantics)
- [x] Verify `backend/libs/go` and `backend/services/stigmer-server` build cleanly

### Notes
- **No surprises**: Followed the exact consolidation pattern from Task 2. No new architectural decisions required.
- **Type assertion eliminated**: The old private `findBySlug` returned `(proto.Message, error)` requiring `found.(T)` at the call site. The shared helper returns `(T, bool, error)` directly — cleaner and type-safe.
- **Net reduction**: ~30 lines removed (private method deleted), ~3 lines changed in Execute.
- **Doc comment fix**: The struct comment incorrectly said "Apply operations" — `LoadExistingStep` is for Update/Delete, not Apply (that's `LoadForApplyStep`).

## Task 4: Fix CheckDuplicateStep.findBySlug — add org filter so same slug can exist in different orgs

**Status**: ✅ DONE
**Created**: 2026-03-03 06:53
**Completed**: 2026-03-03

### Subtasks
- [x] Replace private `findBySlug` call with shared `FindResourceBySlug[T]` helper
- [x] Extract `slug` and `org` from metadata, pass org to helper
- [x] Use `found` bool instead of `existing != nil`; type assertion via `any(existing).(HasMetadata)`
- [x] Add org to duplicate error message for debuggability
- [x] Delete private `findBySlug` method (~30 lines)
- [x] Remove unused imports (`"context"`, `apiresourcekind`)
- [x] Update struct and Execute doc comments to reflect org-scoped semantics
- [x] Verify backend libs and stigmer-server build cleanly

### Notes
- Followed same consolidation pattern as Tasks 2–3. No new architectural decisions.
- Error message uses `existingMetadata.Org` so the reported org is the resource’s org, not the request org.

## Task 5: Fix ID-based lookups — add org verification after load in LoadExistingStep, LoadTargetStep, LoadExistingForDeleteStep

**Status**: ⏭️ N/A
**Created**: 2026-03-03 06:53
**Resolved**: 2026-03-03

### Subtasks
- [x] Investigated cloud implementation for comparison
- [x] Determined task is not applicable — cloud pattern does not verify org after ID-based loads

### Notes
- **Cloud comparison**: `GetOperationLoadTargetStepV2`, `DeleteOperationLoadExistingStepV2`, and `UpdateOperationLoadExistingResourceStepV2` in `stigmer-cloud` all load by ID via `repository.findById()` without org verification. The cloud relies on FGA (Fine-Grained Authorization) for access control on ID-based operations, not pipeline-level org checks.
- **OSS alignment**: Tasks 1–4 already aligned OSS with the cloud pattern — slug lookups are org-scoped, ID lookups are direct. `preserveImmutableFields` preserves org on updates. This matches cloud exactly.
- **IDs are globally unique ULIDs** (e.g. `agt-01arz3ndektsv4rrffq69g5fav`), so cross-org ID collision is impossible. The remaining access-control gap is an authorization concern (FGA), not a pipeline step concern.
- **No code changes required.**

## Task 6: Update all existing tests and add org-scoping tests for each fixed step

**Status**: ✅ DONE
**Created**: 2026-03-03 06:53
**Completed**: 2026-03-03

### Subtasks
- [x] Create `helpers_test.go` with 6 direct unit tests for `FindResourceBySlug` (org match, different-org isolation, multi-org disambiguation, empty-org backward compat, no matching slug, empty store)
- [x] Update `TestLoadForApplyStep_ResourceExists` to include `Org: "default"` in test data
- [x] Add `TestLoadForApplyStep_OrgScoping` with 2 subtests (same-slug-different-org creates, same-slug-same-org updates)
- [x] Add `TestLoadExistingStep_SlugFallback` with 3 subtests (slug+org loads, slug+different-org not-found, slug+empty-org matches) — fills pre-existing gap of zero coverage on slug fallback path
- [x] Update `TestCheckDuplicateStep_DuplicateExists` to include `Org: "default"` in test data
- [x] Add `TestCheckDuplicateStep_OrgScoping` with 3 subtests (different-org allowed, same-org duplicate, error includes org)
- [x] All 63 tests pass, backend libs and stigmer-server build cleanly

### Notes
- **New file**: `helpers_test.go` — first-ever tests for the shared `FindResourceBySlug` helper
- **Pre-existing gap filled**: `LoadExistingStep` slug fallback path had zero test coverage (only ID path tested). Now covered with 3 org-scoped subtests.
- **Surprise: `NewRequestContext` clones input** — `proto.Clone(input)` creates `newState`, so `ctx.NewState()` returns a clone, not the original pointer. Tests must assert on `reqCtx.NewState()` for fields set by steps, not on the original input variable.
- **Style**: New tests use testify + subtests (matching `load_by_reference_test.go`). Existing tests updated minimally (added Org field only).
- **Flagged tech debt**: `LoadByReferenceStep.findBySlug` still duplicates `FindResourceBySlug` logic (out of scope for this task).


## Project Completion Checklist

When all tasks are done:
- [x] All tasks marked ✅ DONE
- [x] Final testing completed
- [x] Documentation updated (if applicable)
- [x] Code reviewed/validated
- [x] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

