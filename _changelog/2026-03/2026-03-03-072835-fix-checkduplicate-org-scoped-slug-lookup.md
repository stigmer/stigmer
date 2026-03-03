# Fix CheckDuplicateStep Org-Scoped Slug Lookup

**Date**: March 3, 2026

## Summary

Fixed `CheckDuplicateStep.findBySlug` to enforce org-scoped slug uniqueness. The step now uses the shared `FindResourceBySlug[T]` helper with `metadata.Org`, so the same slug can exist in different orgs and duplicates are only reported within the same org. Removed the private `findBySlug` implementation (~33 lines) and updated docs and error messages.

## Problem Statement

`CheckDuplicateStep` runs before create to ensure no existing resource has the same slug. It was searching by slug globally with no org filter, so creating `default/my-skill` failed if `local/my-skill` already existed — violating the rule that slugs are org-scoped and the same slug may exist in different orgs.

### Pain Points

- Valid creates in org A were rejected when org B had the same slug
- Duplicate-check semantics did not match LoadForApplyStep and LoadExistingStep (already org-scoped)
- Inconsistent with design: slugs are org-scoped, not globally unique

## Solution

Replaced the private `findBySlug` with the shared `FindResourceBySlug[T]` helper (same pattern as Tasks 2–3). The step now passes `metadata.Org` so the duplicate check is limited to the same org; empty org continues to mean no filter (global check, backwards-compatible).

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/libs/go/grpc/request/pipeline/steps/duplicate.go` | Execute calls `FindResourceBySlug[T]` with slug and org; uses `found` bool; duplicate error includes org; private `findBySlug` removed; unused imports and doc comments updated |

### Key Changes

- **Execute**: Extracts `slug` and `org` from metadata; calls `FindResourceBySlug[T](ctx.Context(), s.store, kind, slug, org)`; uses `found` instead of nil-check on result
- **Error message**: `already exists in org '%s' (id: %s)` using `existingMetadata.Org` for debuggability
- **Private method removed**: ~30-line `findBySlug` deleted; logic lives in shared helper
- **Imports**: Dropped `"context"` and `apiresourcekind`
- **Doc comments**: Struct and Execute updated to describe org-scoped duplicate check and empty-org fallback

## Benefits

- Same slug can exist in different orgs; duplicate check only within one org
- Single implementation for slug+org lookup (shared helper)
- Clearer errors (org in message) and accurate docs
- ~33 lines removed from duplicate.go

## Impact

- **Create operations**: Org-scoped duplicate check; no false positives across orgs
- **Multi-org**: Aligns CheckDuplicateStep with LoadForApplyStep and LoadExistingStep
- **Pipeline library**: Fourth step using shared `FindResourceBySlug`; slug lookups consistently org-scoped

## Related Work

- Preceded by: [Fix LoadExistingStep Org-Scoped Slug Lookup](2026-03-03-072354-fix-loadexisting-org-scoped-slug-lookup.md) (Task 3)
- Part of project: `20260303.01.fix-oss-org-scoping`
- Next: Task 5 — ID-based lookups org verification (LoadExistingStep, LoadTargetStep, LoadExistingForDeleteStep)

---

**Status**: ✅ Production Ready  
**Timeline**: Single session (Task 4)
