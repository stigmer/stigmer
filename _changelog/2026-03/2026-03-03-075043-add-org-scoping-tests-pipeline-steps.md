# Add Org-Scoping Tests for Pipeline Steps

**Date**: March 3, 2026

## Summary

Added comprehensive org-scoping tests for the four pipeline steps fixed in the org-tenancy migration: `FindResourceBySlug`, `LoadForApplyStep`, `LoadExistingStep`, and `CheckDuplicateStep`. These tests prove the business invariant that slugs are org-scoped identifiers and that cross-org resource isolation is enforced. Also filled a pre-existing gap where `LoadExistingStep`'s slug fallback path had zero test coverage.

## Problem Statement

Tasks 1-4 added org-scoping to all slug-based lookups in the shared pipeline steps, fixing the root cause of the seedpack bootstrap bug. However, no tests existed to verify the org-isolation behavior, and several existing tests used incomplete test data (no `Org` field). The slug fallback path in `LoadExistingStep` had zero test coverage entirely.

### Pain Points

- `FindResourceBySlug` had no tests at all (no `helpers_test.go`)
- Existing tests for `LoadForApplyStep`, `LoadExistingStep`, and `CheckDuplicateStep` never set `Org` in test data, meaning the org-scoped code paths were untested
- `LoadExistingStep` slug fallback (the path fixed in Task 3) had zero coverage -- only the ID-based lookup was tested
- No test proved that the same slug in different orgs is treated as distinct resources

## Solution

Created new test file `helpers_test.go` and extended three existing test files with org-scoping subtests. Used testify + subtests pattern (matching the newest test file `load_by_reference_test.go`). Updated existing tests to include `Org` in test data so they exercise the org-scoped code path.

## Implementation Details

### New: `helpers_test.go` (6 subtests)

Direct unit tests for the shared `FindResourceBySlug` helper:
- Finds resource by slug and org
- Does not find resource in different org (core isolation test)
- Same slug in multiple orgs returns correct one
- Empty org parameter matches any org (backward compat)
- No matching slug returns not found
- Empty store returns not found

### Extended: `load_for_apply_test.go` (+2 subtests, 1 updated)

- Updated `TestLoadForApplyStep_ResourceExists` to include `Org: "default"`
- Added `TestLoadForApplyStep_OrgScoping`: same slug in different org triggers CREATE (the exact bootstrap bug scenario); same slug in same org triggers UPDATE

### Extended: `load_existing_test.go` (+3 subtests)

- Added `TestLoadExistingStep_SlugFallback`: loads by slug when ID is empty; slug with different org returns not found; slug with empty org matches any. This fills the pre-existing gap of zero coverage on the slug fallback path.

### Extended: `duplicate_test.go` (+3 subtests, 1 updated)

- Updated `TestCheckDuplicateStep_DuplicateExists` to include `Org: "default"`
- Added `TestCheckDuplicateStep_OrgScoping`: same slug in different org is allowed; same slug in same org is duplicate; error message includes org name

### Discovery: `NewRequestContext` clones input

`pipeline.NewRequestContext(ctx, input)` creates `newState` via `proto.Clone(input).(T)`. Test assertions on fields set by pipeline steps must use `reqCtx.NewState()`, not the original input pointer.

## Benefits

- All org-scoping fixes from Tasks 1-4 are now verified by tests
- Pre-existing slug fallback gap in `LoadExistingStep` is covered
- 14 new test cases across 4 files, bringing total pipeline step tests to 63
- Test data now uses realistic org values, exercising actual code paths
- Future regressions in org-scoping will be caught immediately

## Impact

- **Pipeline steps test suite**: 49 tests -> 63 tests (+14)
- **Files changed**: 1 new (`helpers_test.go`), 3 modified (`load_for_apply_test.go`, `load_existing_test.go`, `duplicate_test.go`)
- **Coverage**: `FindResourceBySlug` goes from 0% to direct unit test coverage; slug fallback in `LoadExistingStep` goes from 0% to org-scoped coverage

## Related Work

- Follows `2026-03-03-070207-fix-findresourcebyslug-org-scoping.md` (Task 1)
- Follows `2026-03-03-071639-fix-loadforapply-org-scoped-slug-lookup.md` (Task 2)
- Follows `2026-03-03-072354-fix-loadexisting-org-scoped-slug-lookup.md` (Task 3)
- Follows `2026-03-03-072835-fix-checkduplicate-org-scoped-slug-lookup.md` (Task 4)
- Completes project `20260303.01.fix-oss-org-scoping` (Task 6 of 6)

---

**Status**: Production Ready
**Timeline**: ~30 minutes
