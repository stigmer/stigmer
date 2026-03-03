# Fix LoadExistingStep Org-Scoped Slug Lookup

**Date**: March 3, 2026

## Summary

Fixed `LoadExistingStep.findBySlug` to perform org-scoped slug lookups instead of matching globally across orgs. This prevents cross-org slug collisions in Update and Delete operations that fall back to slug-based resource lookup. Consolidated into the shared `FindResourceBySlug[T]` helper, eliminating ~30 lines of duplicated code.

## Problem Statement

`LoadExistingStep` is used in Update and Delete operations. When a client provides a slug instead of an ID, the step falls back to a slug-based lookup to find the existing resource. This lookup matched slugs globally with no org awareness, meaning a request targeting `default/my-skill` could match `local/my-skill` instead.

### Pain Points

- Update-by-slug could modify a resource in the wrong org
- Delete-by-slug could delete a resource from the wrong org
- Same slug in different orgs was treated as a collision when it should be valid
- Inconsistent with `LoadByReferenceStep` which correctly filters by org

## Solution

Replaced the private `findBySlug` method with the shared `FindResourceBySlug[T]` helper (already org-scoped and returning `(T, bool, error)` from Tasks 1-2). Same consolidation pattern applied in Task 2 for `LoadForApplyStep`.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/libs/go/grpc/request/pipeline/steps/load_existing.go` | Deleted private `findBySlug`, delegates to shared helper with `metadata.Org`; removed unused imports; fixed inaccurate doc comment |

### Key Changes

- **Slug branch in Execute**: Extracts `org := metadata.Org` and passes to `FindResourceBySlug[T]` instead of calling private method
- **Type assertion eliminated**: Old private method returned `(proto.Message, error)` requiring `found.(T)` cast; shared helper returns `T` directly
- **`found == nil` replaced with `!found`**: Correct pattern for generic code where nil comparison on type parameters is not allowed
- **Unused imports removed**: `"context"` and `apiresourcekind` were only referenced in the deleted private method's signature
- **Doc comment fixed**: Incorrectly said "Apply operations" — corrected to describe org-scoped Update/Delete semantics

## Benefits

- Enforces org-scoped slug matching for Update and Delete slug fallback paths
- Removes ~30 lines of duplicated slug-lookup code
- Eliminates unsafe `proto.Message` -> `T` type assertion at the call site
- Accurate documentation reflecting actual step semantics

## Impact

- **Update/Delete operations**: Slug fallback now correctly scoped to the requesting org
- **Multi-org isolation**: Same slug in different orgs no longer causes incorrect resource matching on Update/Delete
- **Code health**: Third pipeline step consolidated into shared helper, establishing consistent pattern across the pipeline library

## Related Work

- Preceded by: [Fix LoadForApplyStep Org-Scoped Slug Lookup](2026-03-03-071639-fix-loadforapply-org-scoped-slug-lookup.md) (Task 2)
- Part of project: `20260303.01.fix-oss-org-scoping` (Tasks 4-6 remaining)
- Next: Task 4 — `CheckDuplicateStep.findBySlug` org scoping

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes (Task 3 of 6 in org-scoping project)
