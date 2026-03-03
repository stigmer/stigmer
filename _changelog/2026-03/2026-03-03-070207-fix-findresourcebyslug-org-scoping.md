# Fix FindResourceBySlug Org Scoping

**Date**: March 3, 2026

## Summary

Added org-scoped filtering to the shared `FindResourceBySlug` helper and its caller in the skill push controller. This is the first of six tasks in the org-scoping fix project that addresses a systematic gap where slug lookups match globally across organizations instead of being scoped to the requesting org.

## Problem Statement

`FindResourceBySlug` in `helpers.go` treated slugs as globally unique identifiers. In the domain model, slugs are org-scoped — the same slug can exist in different organizations. The function's API had no way to express this constraint.

### Pain Points

- Slug lookups returned the first match across all orgs, violating org isolation
- The skill push controller's `FindExistingBySlugStep` could match a skill from the wrong org
- Combined with `metadata.Org` immutability on updates (`build_update_state.go`), this could permanently lock resources into the wrong org

## Solution

Added an `org string` parameter to `FindResourceBySlug` and applied the same org filter guard already used in the only correctly-implemented step (`LoadByReferenceStep.findBySlug`):

```go
if org != "" && metadata.Org != org {
    continue
}
```

Updated the single caller in `push.go` to pass `skill.Metadata.Org` (sourced from `req.Org`).

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `backend/libs/go/grpc/request/pipeline/steps/helpers.go` | Added `org string` parameter to `FindResourceBySlug`, added org filter, updated doc comment |
| `backend/services/stigmer-server/pkg/domain/skill/controller/push.go` | Pass `skill.Metadata.Org` to `FindResourceBySlug` call |

### Design Decisions

- **Empty org = no filtering**: `org == ""` disables the filter for backward compatibility. Callers without org context can pass empty string and get the previous global behavior.
- **Return type unchanged**: Kept `(T, error)` rather than changing to `(T, bool, error)` like the reference implementation — that's a separate refactoring concern.
- **In-memory filtering**: `ListResources` still returns all resources; org filtering happens in the loop. Appropriate for OSS scale.

## Benefits

- Skill push operations now correctly scope slug lookups to the requesting org
- Prevents cross-org slug collisions in the skill push path
- Establishes the pattern for Tasks 2-4 which fix the remaining private `findBySlug` methods

## Impact

- **Skill push controller**: Now org-aware when checking for existing skills by slug
- **Shared helper API**: Breaking signature change — all future callers must provide org
- **Part 1 of 6**: This is the foundation task; Tasks 2-4 apply the same pattern to `LoadForApply`, `LoadExisting`, and `CheckDuplicate` pipeline steps

## Related Work

- Part of project `20260303.01.fix-oss-org-scoping`
- Follows the org-tenancy migration (`20260302.01.org-tenancy-portable-resources`)
- Unblocks the seedpack bootstrap under org `default` (full fix requires Task 2)

---

**Status**: ✅ Production Ready
**Timeline**: Task 1 of 6 in the org-scoping fix project
