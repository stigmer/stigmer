---
name: Fix FindResourceBySlug Org Scoping
overview: Add org parameter to the shared FindResourceBySlug helper and update its single caller (skill push) to enforce org-scoped slug lookups, consistent with the reference implementation in LoadByReferenceStep.
todos:
  - id: update-helpers-go
    content: Add org parameter to FindResourceBySlug in helpers.go with org filter and updated doc comment
    status: completed
  - id: update-push-caller
    content: Pass skill.Metadata.Org at the call site in push.go
    status: completed
  - id: verify-build
    content: Run go build to confirm the signature change compiles cleanly
    status: completed
isProject: false
---

# Task 1: Fix FindResourceBySlug Shared Helper

## Domain Analysis

**The problem:** `FindResourceBySlug` treats slugs as globally unique identifiers. In the domain model, slugs are **org-scoped** -- a slug is only unique within an org, not globally. The function's API doesn't express this domain constraint, so it returns the first resource matching the slug regardless of which org it belongs to.

**The fix:** Add an `org string` parameter and apply the same org guard used in the only correctly-implemented step (`LoadByReferenceStep.findBySlug`).

**Why this matters:** Because `build_update_state.go` line 129 makes `metadata.Org` immutable on updates (`mergedMeta.Org = existingMeta.Org`), a slug match against the wrong org permanently locks a resource into its original org. This is the root mechanism behind the seedpack bootstrap bug.

## Scope

Exactly **2 files**, **2 changes**. No new files.

## Change 1: Add `org` parameter to `FindResourceBySlug`

**File:** [backend/libs/go/grpc/request/pipeline/steps/helpers.go](backend/libs/go/grpc/request/pipeline/steps/helpers.go)

Current signature (line 30):

```go
func FindResourceBySlug[T proto.Message](ctx context.Context, s store.Store, kind apiresourcekind.ApiResourceKind, slug string) (T, error) {
```

New signature:

```go
func FindResourceBySlug[T proto.Message](ctx context.Context, s store.Store, kind apiresourcekind.ApiResourceKind, slug string, org string) (T, error) {
```

Add org filter inside the slug match block (after line 53), replicating the exact pattern from `load_by_reference.go` lines 161-163:

```go
if metadata != nil && metadata.Slug == slug {
    if org != "" && metadata.Org != org {
        continue
    }
    return resource, nil
}
```

Update the doc comment to document org behavior:

- Explain that `org` scopes the lookup to a specific organization
- Explain that empty `org` disables filtering (backward-compatible semantics)
- Update the usage example to include the org parameter

## Change 2: Pass `org` at the call site in skill push

**File:** [backend/services/stigmer-server/pkg/domain/skill/controller/push.go](backend/services/stigmer-server/pkg/domain/skill/controller/push.go)

Current call (lines 206-211):

```go
existingSkill, err := steps.FindResourceBySlug[*skillv1.Skill](
    ctx.Context(),
    s.store,
    apiresourcekind.ApiResourceKind_skill,
    slug,
)
```

Updated call:

```go
existingSkill, err := steps.FindResourceBySlug[*skillv1.Skill](
    ctx.Context(),
    s.store,
    apiresourcekind.ApiResourceKind_skill,
    slug,
    skill.Metadata.Org,
)
```

`skill.Metadata.Org` is already set from `req.Org` in `BuildInitialSkillStep` (line 128), so this is the correct org to scope against.

## What we are NOT changing (and why)

- **Return type stays `(T, error)`:** The reference `findBySlug` in `LoadByReferenceStep` uses `(T, bool, error)`, but changing the return type here would be a separate refactoring concern. The nil-check pattern at the call site is clear and works correctly for proto messages.
- **No test file changes:** There is no `helpers_test.go` and no existing tests reference `FindResourceBySlug`. New tests are deferred to Task 6 per the task plan.
- **No store interface changes:** `ListResources` remains org-unaware; filtering stays in-memory, which is appropriate for OSS scale.

## Verification

- `go build ./backend/...` must pass (signature change must compile with updated caller)
- Grep for any other callers of `FindResourceBySlug` (confirmed: only 1 caller in `push.go`)

