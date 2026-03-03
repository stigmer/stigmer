---
name: Task 4 CheckDuplicate org-scoping
overview: Fix CheckDuplicateStep.findBySlug to enforce org-scoped slug uniqueness by consolidating into the shared FindResourceBySlug helper, following the exact pattern from Tasks 2-3.
todos:
  - id: update-execute
    content: "Update Execute method: extract org, delegate to FindResourceBySlug[T], use found bool, add org to error message"
    status: completed
  - id: delete-findbyslug
    content: Delete private findBySlug method and remove unused imports (context, apiresourcekind)
    status: completed
  - id: update-doc-comments
    content: Update struct and method doc comments to reflect org-scoped semantics
    status: completed
  - id: build-verify
    content: Run go build ./backend/... to verify all modules compile cleanly
    status: completed
isProject: false
---

# Task 4: Fix CheckDuplicateStep.findBySlug — org-scoped duplicate check

## What and why

`CheckDuplicateStep` in `[duplicate.go](backend/libs/go/grpc/request/pipeline/steps/duplicate.go)` currently searches for existing resources by slug **globally** (no org filter). This means creating a resource with slug `my-skill` in org `default` will fail if org `local` already has a `my-skill` — violating the design rule that slugs are org-scoped.

## Change summary

Single file change: `[backend/libs/go/grpc/request/pipeline/steps/duplicate.go](backend/libs/go/grpc/request/pipeline/steps/duplicate.go)`

### 1. In `Execute` method (lines 46-83)

- Extract `org := metadata.Org` (same pattern as Tasks 2-3)
- Replace `s.findBySlug(ctx.Context(), metadata.Slug, kind)` with:

```go
  existing, found, err := FindResourceBySlug[T](ctx.Context(), s.store, kind, metadata.Slug, org)
  

```

- Replace `if existing != nil` with `if found`
- The `existing` is now typed `T` directly — the `existing.(HasMetadata)` type assertion on line 76 stays but operates on `T` instead of `proto.Message`
- Add `org` to the error message for debuggability:
  - Before: `%s with slug '%s' already exists (id: %s)`
  - After: `%s with slug '%s' already exists in org '%s' (id: %s)`

### 2. Delete private `findBySlug` method (lines 85-114)

~30 lines removed — the shared `FindResourceBySlug[T]` in `[helpers.go](backend/libs/go/grpc/request/pipeline/steps/helpers.go)` handles this with org filtering already built in.

### 3. Remove unused imports

- `"context"` — no longer needed (private findBySlug deleted)
- `apiresourcekind` — no longer needed (kind is only passed through, not used in import)

### 4. Update doc comments

- Struct comment (lines 15-22): change "by slug globally" to "by slug within the same org"
- Remove reference to global search semantics

## Safety properties

- **org set**: duplicate check is scoped to that org (desired behavior — same slug allowed in different orgs)
- **org empty**: no filtering applied, falls back to global check (backwards-compatible, more restrictive)

## Out-of-scope observation

The duplicate error uses `fmt.Errorf` (line 79), which surfaces as gRPC `INTERNAL` to clients. The correct gRPC status would be `ALREADY_EXISTS`. This is pre-existing and not part of this task — flagging for future consideration.

## Verification

- `go build ./backend/...` — all 9 workspace modules build cleanly

