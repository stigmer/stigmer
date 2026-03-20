# Fix Organization Creation Slug Validation

**Date**: March 20, 2026

## Summary

Fixed a bug where creating an organization through the web console failed with slug validation errors. The root cause was a backend pipeline ordering issue (validation ran before slug derivation) combined with the frontend not sending the slug field. The fix adds client-side slug generation with live preview, and reorders the backend pipeline in both Go (OSS) and Java (Cloud) to be resilient to missing slugs.

## Problem Statement

Clicking "Create organization" in the Console with a name like "planton" or "Acme Corp" produced a raw validation error:

> pipeline step validateProtoConstraints failed: rpc error: code = InvalidArgument desc = validation errors: metadata.metadata.slug: Only lowercase letters, numbers, and hyphens are allowed...

### Pain Points

- The `CreateOrganizationForm` never sent a `slug` value -- it relied on the backend to derive one from the name.
- The backend create pipeline ran `ValidateProtoStep` (which enforces slug CEL constraints) *before* `ResolveSlugStep` (which derives slug from name). Empty slug failed all three validations.
- The form also sent the raw display name as the `org` field (e.g. `"Acme Corp"`), which is invalid for names containing spaces or special characters.
- Users had no visibility into the slug concept -- there was no field in the UI to show or edit it.

## Solution

Two-layer fix across frontend and backend:

1. **Frontend**: Auto-generate the slug from the name as the user types, show it as an editable field with live validation and helper text, and send it in the create request.
2. **Backend**: Swap pipeline step ordering so `ResolveSlug` runs before `ValidateProto`, making the backend resilient to clients that omit the slug.

## Implementation Details

### Frontend (SDK React)

**`sdk/react/src/internal/slug.ts`** -- Added `generateSlug()` utility that mirrors the backend logic:
- Lowercase, spaces to hyphens, strip non-alphanumeric, collapse consecutive hyphens, trim edges.

**`sdk/react/src/organization/CreateOrganizationForm.tsx`** -- Redesigned the form:
- New **Slug** field auto-derived from Name on each keystroke via `generateSlug()`.
- Manual override support: once the user edits the slug directly, auto-derivation stops.
- Client-side validation matching the Organization proto CEL rules (2-15 chars, `^[a-z][a-z0-9-]*$`), with inline error messages and a destructive border on invalid input.
- Fixed the `org` field to use the slug value instead of the raw display name.
- Added helper text: Name ("A human-readable display name") and Slug ("URL-friendly identifier used in resource references").
- Slug input uses `font-mono` to visually distinguish it as a machine-friendly identifier.

### Backend (Go OSS + Java Cloud)

**`backend/services/stigmer-server/pkg/domain/organization/controller/create.go`** -- Swapped `ResolveSlugStep` to position 1, before `ValidateProtoStep`.

**`OrganizationCreateHandler.java`** (stigmer-cloud) -- Same fix: moved `commonSteps.resolveSlug` to the first pipeline step, before `commonSteps.validateFieldConstraints`.

## Benefits

- Organization creation works correctly from the web console for any valid name.
- Users now see the slug field and understand it as a first-class concept.
- Client-side validation catches invalid slugs before hitting the server.
- Backend is resilient: CLI, API, and SDK consumers that omit the slug still get correct behavior.

## Impact

- **End users**: Organization creation no longer fails with cryptic validation errors.
- **Platform builders**: `CreateOrganizationForm` now exposes the slug concept, educating users about the `org/slug` reference pattern used throughout the platform.
- **Backend consumers**: Any client (CLI, API, SDK) that omits the slug will have it correctly derived before validation.

## Related Work

- Organization proto: `apis/ai/stigmer/tenancy/organization/v1/api.proto` (CEL validation rules unchanged)
- Backend slug generation: `backend/libs/go/grpc/request/pipeline/steps/slug.go` (logic mirrored to frontend)

---

**Status**: Production Ready
