# Fix LoadForApplyStep Org-Scoped Slug Lookup (Root Cause of Bootstrap Bug)

**Date**: March 3, 2026

## Summary

Fixed `LoadForApplyStep.findBySlug` to perform org-scoped slug lookups instead of matching globally across orgs. This was the root cause of the seedpack bootstrap bug where agents stayed stuck under org `local` despite being re-applied with org `default`. Also upgraded `FindResourceBySlug` return type from `(T, error)` to `(T, bool, error)` to correctly model lookup semantics in generic Go code.

## Problem Statement

After the org-tenancy migration, the CLI default org changed from `local` to `default`. The seedpack bootstrap re-applied agents with `metadata.org: default`, but the server's `LoadForApplyStep.findBySlug` matched the existing `local/skill-creator` resource by slug globally (ignoring org), routed to UPDATE, and `BuildUpdateState` preserved `org: local` as immutable. Agents were permanently unreachable under the new default org.

### Pain Points

- System agents created under `local` were invisible to CLI commands using org `default`
- Seedpack bootstrap appeared to succeed but silently updated the wrong resource
- `stigmer draft skill` failed with "skill-creator agent not found in organization default"
- Same slug in different orgs was impossible due to global matching

## Solution

Replaced `LoadForApplyStep`'s private `findBySlug` method with the shared `FindResourceBySlug[T]` helper (already org-scoped from Task 1). This eliminated duplicated code while fixing the org-scoping gap.

During implementation, discovered that Go generics does not allow `T == nil` comparisons on type parameters constrained to interfaces. Upgraded `FindResourceBySlug` return type from `(T, error)` to `(T, bool, error)` with an explicit `found` boolean, aligning with the reference implementation in `LoadByReferenceStep.findBySlug`.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/libs/go/grpc/request/pipeline/steps/helpers.go` | Return type `(T, error)` -> `(T, bool, error)` |
| `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go` | Deleted private `findBySlug`, delegates to shared helper with org param |
| `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` | Updated caller to use new `(T, bool, error)` signature |

### Key Design Decisions

- **Consolidation over patching**: Deleted the ~30-line private method instead of adding an org param, eliminating code duplication.
- **`(T, bool, error)` return type**: Models three business outcomes explicitly (found / not-found / error). Go's type system does not support nil comparison on generic type parameters, making the bool necessary.
- **Backward compatibility**: `org=""` skips filtering (`if org != "" && metadata.Org != org { continue }`), preserving behavior for callers without org context.

## Benefits

- Fixes the root cause of the seedpack bootstrap bug — agents can now be created under org `default` even when a same-slug resource exists under org `local`
- Removes ~25 lines of duplicated slug-lookup code from `load_for_apply.go`
- `FindResourceBySlug` API now correctly consumable from generic pipeline step code
- Establishes consolidation pattern for remaining Tasks 3-4 (LoadExistingStep, CheckDuplicateStep)

## Impact

- **Seedpack bootstrap**: Will correctly create new agents under org `default` instead of silently updating wrong-org resources
- **Multi-org isolation**: Same slug can now exist in different orgs through the apply path
- **Pipeline steps library**: `FindResourceBySlug` is now the canonical slug-lookup function with a clean generic-safe API

## Related Work

- Preceded by: [Fix FindResourceBySlug Org Scoping](2026-03-03-070207-fix-findresourcebyslug-org-scoping.md) (Task 1 — added org param)
- Part of project: `20260303.01.fix-oss-org-scoping` (Tasks 3-6 remaining)
- Related to: Org-tenancy portable resources migration

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (Task 2 of 6 in org-scoping project)
