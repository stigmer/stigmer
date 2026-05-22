# Slug and Name Validation Overhaul

**Date**: May 19, 2026

## Summary

Relaxed the overly restrictive Organization slug length limit from 2-15 to 2-63 characters, established a unified validation strategy across all API resources via `ApiResourceMetadata`, and adopted `@bufbuild/protovalidate` in the React SDK to eliminate manually-mirrored validation rules.

## Problem Statement

The Organization slug was limited to 2-15 characters by CEL rules defined directly on the Organization proto. This was the only resource with explicit slug validation on its metadata field. A name like "tiny-tactics-demo" (16 chars) would fail validation unnecessarily.

### Pain Points

- Organization slug limit of 15 chars was too restrictive for real-world names
- Validation rules were Organization-specific, not applied to other resources (Agent, Workflow, etc.)
- `metadata.name` had zero validation across the entire proto surface
- Frontend hardcoded `SLUG_MIN=2`, `SLUG_MAX=15`, `SLUG_PATTERN` in `CreateOrganizationForm.tsx`, manually mirroring proto CEL rules -- drift-prone
- `ApiResourceReference.slug` used a different pattern and min_len (1) than Organization (2), creating internal inconsistency

## Solution

Established protos as the single source of truth for validation, with rules defined once on `ApiResourceMetadata` and enforced identically across backend (Java protovalidate), CLI (Go protovalidate), and frontend (TypeScript `@bufbuild/protovalidate`).

## Implementation Details

### Proto changes

- **`metadata.proto`**: Added `name` (max 63 chars) and `slug` (2-63 chars, `^[a-z][a-z0-9-]*[a-z0-9]$`) validation with `IGNORE_IF_ZERO_VALUE` to skip when empty (server generates slug from name)
- **`organization/v1/api.proto`**: Removed the 3 CEL overrides -- validation now inherited from metadata
- **`io.proto`**: Aligned `ApiResourceReference.slug` and `.org` to use same pattern/limits (2-63, no trailing hyphen)
- **`buf.lock`**: Updated protovalidate dependency to version supporting `IGNORE_IF_ZERO_VALUE`

### Frontend changes

- **`sdk/react/package.json`**: Added `@bufbuild/protovalidate ^1.1.1` as dependency, bumped `@bufbuild/protobuf` peer to `^2.8.0`
- **`sdk/react/src/internal/validate.ts`**: New shared utility wrapping protovalidate -- `validateMessage()` and `getFieldError()` helpers
- **`CreateOrganizationForm.tsx`**: Replaced hardcoded constants and `validateSlug()` with protovalidate-based validation against `ApiResourceMetadataSchema`; added name field validation display

### Stub regeneration

- Regenerated TypeScript stubs in stigmer-cloud to include new validation annotations in the file descriptors

## Benefits

- **Single source of truth**: Proto annotations drive validation in all three runtimes (Java, Go, TypeScript)
- **No more drift**: Frontend/backend validation messages are guaranteed identical -- eliminated an entire class of bugs
- **Consistent across resources**: All resources (Organization, Agent, Workflow, etc.) now inherit the same baseline slug/name rules
- **Generous limits**: 63 chars (DNS label standard) covers virtually any reasonable name while preventing abuse
- **No trailing hyphens**: Pattern `^[a-z][a-z0-9-]*[a-z0-9]$` ensures clean slugs in URLs and references

## Impact

- All users creating organizations with names > 15 chars (like "tiny-tactics-demo") can now proceed without hitting the artificial limit
- Developers adding new resource types get slug/name validation automatically without any proto annotation work
- Frontend developers no longer need to manually mirror proto validation rules

## Related Work

- Aligns with DNS label convention (RFC 1035, max 63 chars)
- Consistent with Kubernetes label/namespace limits
- Matches existing `ApiResourceReference.slug` format (was already 63 chars)

---

**Status**: ✅ Production Ready
