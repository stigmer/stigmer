# Clickable Status Nested Types in SDK Reference Docs

**Date**: April 4, 2026

## Summary

Extended the codegen pipeline to extract and render status nested types (e.g., `ApiResourceAudit`, `ApiResourceAuditInfo`, `ApiResourceAuditActor`) as documented sections on SDK reference pages. Status type fields now render as clickable links, completing the clickable type coverage across all three documentation layers: spec types, method types, and status types.

## Problem Statement

After making spec nested types and method parameter types clickable in earlier sessions, status type fields like `ApiResourceAudit` in the `AgentStatus` TypeTable still rendered as plain text. Users could not click through to see what audit fields contain (spec audit, status audit, created by, timestamps, etc.).

### Pain Points

- `ApiResourceAudit` appeared as non-interactive plain text in every resource's status section
- SDK users had no way to discover audit structure (spec vs status audit, actors, timestamps) from the docs
- Inconsistency: spec types and method types were clickable, but status types were not
- The `proto2schema` pipeline did not extract nested types from status messages, so the generator had no schema to render

## Solution

Extended both stages of the codegen pipeline to handle status nested types:

1. **proto2schema** now recursively collects nested types from status message fields using the existing `collectNestedTypes()` function, stored as `statusNestedTypes` in the service schema JSON
2. **sdk_docs.go** renders these types as `### TypeName` sections with `<TypeTable>` components after the status type, and includes them in the documented type set so status fields get `typeDescriptionLink` anchors

## Implementation Details

### Stage 1: Schema Extraction (`proto2schema/main.go`)

- Added `StatusNestedTypes []TypeSchema` field to `ServiceSchemaFile`
- Extended `extractResourceAndStatusSchemas()` to call `collectNestedTypes()` on the status message, populating `statusNestedTypes` with fully resolved type schemas
- Reuses existing recursive type collection — no new extraction logic needed

### Stage 2: Doc Generation (`sdk_docs.go` + `sdk_client.go`)

- Added `StatusNestedTypes []MethodTypeSchema` field to the generator's `ServiceSchemaFile`
- Extended `docBuildDocumentedTypeSet()` to include status nested type names, enabling `typeDescriptionLink` resolution
- Added `docWriteStatusNestedTypes()` — renders each status nested type as a `### TypeName` heading with description and `<TypeTable>`, with its own deduplication tracking
- Status nested type fields that reference other status nested types (e.g., `ApiResourceAuditInfo` → `ApiResourceAuditActor`) are also clickable via `docResponseFieldTypeLink()`

### Types Now Documented Per Page

| Proto Type | Rendered As | Fields |
|---|---|---|
| `ApiResourceAudit` | `### ApiResourceAudit` | specAudit, statusAudit |
| `ApiResourceAuditInfo` | `### ApiResourceAuditInfo` | createdBy, createdAt, updatedBy, updatedAt, event |
| `ApiResourceAuditActor` | `### ApiResourceAuditActor` | id, avatar |

## Benefits

- Complete clickable type coverage — every message type reference in SDK docs is now a working link
- Self-contained audit documentation on every resource page
- Consistent UX across spec, method, and status type references
- Automatic extraction from protos — no manual maintenance as audit types evolve

## Impact

- **17 SDK reference pages** updated with clickable status nested types
- **8 service schema JSON files** enriched with `statusNestedTypes` (resources with non-trivial status types)
- **3 source files** modified: `proto2schema/main.go`, `sdk_client.go`, `sdk_docs.go`
- All checks pass: Prettier formatting, `gen-sdk-docs-check` consistency

## Related Work

- [Clickable Proto Types in SDK Docs](2026-04-04-095410-clickable-proto-types-in-sdk-docs.md) — method parameter/return types
- [Clickable Output Types in SDK Docs](2026-04-04-101245-clickable-output-types-in-sdk-docs.md) — spec and commons input types in TypeTables

---

**Status**: ✅ Production Ready
