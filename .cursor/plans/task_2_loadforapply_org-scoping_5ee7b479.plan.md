---
name: Task 2 LoadForApply org-scoping
overview: Fix LoadForApplyStep.findBySlug to be org-scoped by replacing the private method with a call to the shared FindResourceBySlug helper, eliminating code duplication while fixing the root cause of the seedpack bootstrap bug.
todos:
  - id: update-execute
    content: "Update Execute method: extract org, replace findBySlug call with FindResourceBySlug[T], adjust type assertion, enrich log statements"
    status: completed
  - id: delete-private-method
    content: Delete the private findBySlug method (lines 152-182)
    status: completed
  - id: update-doc-comment
    content: Update struct doc comment to reflect org-scoped slug lookup
    status: completed
  - id: clean-imports
    content: Remove unused 'context' import if no longer needed
    status: completed
  - id: build-verify
    content: Run go build ./backend/... and verify clean compilation
    status: completed
  - id: update-task-tracking
    content: Update tasks.md with subtasks, completion status, and notes
    status: completed
isProject: false
---

# Task 2: Fix LoadForApplyStep.findBySlug — org-scoped slug lookup

## Context

`LoadForApplyStep.findBySlug` matches resources by slug **globally** — no org filter. This is the **root cause** of the seedpack bootstrap bug: applying an agent with `org: default` matches the existing `org: local` copy by slug, routes to UPDATE, and `BuildUpdateState` preserves `org: local` as immutable.

## File

[backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go](backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go)

## Approach: Consolidate into shared helper

Rather than patching the private `findBySlug` with an org param (which would leave duplicated code), **replace it entirely** with a call to the shared `FindResourceBySlug[T]` from [helpers.go](backend/libs/go/grpc/request/pipeline/steps/helpers.go), which was already org-scoped in Task 1.

### Why this is better than just adding an org param

- Eliminates ~30 lines of duplicated slug-lookup logic
- Centralizes the algorithm: future improvements (e.g., indexed queries) happen in one place
- Returns `T` instead of `proto.Message`, improving type safety
- The shared helper already has the correct org filter guard: `if org != "" && metadata.Org != org { continue }`

## Changes

### 1. Update `Execute` method (lines 78-150)

- Extract org alongside slug: `org := metadata.Org`
- Replace call from `s.findBySlug(ctx.Context(), slug, kind)` to `FindResourceBySlug[T](ctx.Context(), s.store, kind, slug, org)`
- Adjust nil check on return value (works as-is: T is a pointer type, nil comparison is valid)
- Adjust type assertion at line 144: `existing.(HasMetadata)` becomes `any(existing).(HasMetadata)` because `existing` is now type `T` (type parameter) rather than `proto.Message` (interface)
- Add `Str("org", org)` to the three `log.Debug()` calls for observability

### 2. Delete private `findBySlug` method (lines 152-182)

Remove entirely — no longer needed.

### 3. Update struct doc comment (lines 23-54)

Change line 27 from:

> Attempts to load existing resource by slug (from metadata.slug set by ResolveSlugStep)

To:

> Attempts to load existing resource by slug+org (from metadata set by ResolveSlugStep)

### 4. Remove unused import

The `"context"` import will become unused after deleting the private method (the shared helper takes `context.Context` from `ctx.Context()` at the call site). Verify and remove if needed.

### 5. Build verification

`go build ./backend/...` must pass cleanly.

## Risk assessment

- **Nil comparison on type parameter T**: Safe. All proto message types are pointer types. The shared helper returns `var zero T` (nil pointer) for not-found. Comparing `existing == nil` on a nil pointer is valid and returns true. This pattern is already used by the Task 1 caller in `push.go`.
- **No behavioral change**: The shared helper uses identical logic (list, unmarshal, slug match, org filter). The only addition is the org filter, which is the intended fix.
- **Backward compatibility**: When `metadata.Org` is empty (no org context), the filter guard `if org != "" && ...` is a no-op, preserving global behavior.

