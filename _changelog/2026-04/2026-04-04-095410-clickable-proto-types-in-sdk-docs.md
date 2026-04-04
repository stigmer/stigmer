# Clickable Proto Types in SDK Reference Docs

**Date**: April 4, 2026

## Summary

Extended the codegen pipeline so that proto message types used as method parameters and return values in SDK reference docs are rendered as clickable links with full field documentation, matching the existing behavior of SDK input types like `AgentInput`. This affects all 17 resource documentation pages across the platform.

## Problem Statement

In the generated SDK reference docs, types originating from proto definitions (e.g., `ApiResourceReference`, `GetDefaultAgentRequest`, `UpdateVisibilityInput`) were rendered as plain backtick text, while SDK input types (e.g., `AgentInput`) were rendered as clickable links pointing to detailed `<TypeTable>` sections showing all fields and their descriptions.

### Pain Points

- SDK users could not click on parameter types to see what fields they need to provide
- Proto-based parameter types required users to look up the proto definitions manually or rely solely on IDE autocomplete
- Inconsistent UX between spec-derived types (clickable) and proto-derived types (plain text)
- Every resource page had the same gap, compounding the friction across the entire SDK surface

## Solution

Extended both stages of the two-stage codegen pipeline:

1. **proto2schema** now extracts full `TypeSchema` definitions for all method input/output message types, stored as `methodTypes` in the service schema JSON
2. **sdk_docs.go** now renders these types as `### TypeName` sections with `<TypeTable>` components, and linkifies type references in method signatures

## Implementation Details

### Stage 1: Schema Extraction (`proto2schema/main.go`)

- Added `MethodTypes []TypeSchema` field to `ServiceSchemaFile`
- Added `collectMethodTypes()` which builds a descriptor map directly from method input/output types (resolving cross-package imports), filters out types with built-in rendering (Empty, ID wrappers, resource type, delete input), and extracts full schemas using the existing `parseSharedType()` function
- Added `shouldSkipMethodType()` for clean filtering logic

### Stage 2: Doc Generation (`sdk_docs.go` + `sdk_client.go`)

- Added `MethodTypeSchema` struct and `MethodTypes` field to the generator's `ServiceSchemaFile`
- Added `docBuildDocumentedTypeSet()` — computes the full set of type names with documented sections before methods are rendered, enabling link resolution
- Added `docWriteMethodTypes()` — renders each proto type as a `### TypeName` heading with description and `<TypeTable>`
- Added `docTypeRef()` — renders type names as `[`TypeName`](#typename)` links when documented, plain backticks otherwise
- Updated `docWriteMethod()` to use `docTypeRef()` for both parameter and return type rendering

### Design Decisions

- **Resource return types** (e.g., `Agent`) are intentionally left as plain text — they follow the standard KRM pattern (apiVersion, kind, metadata, spec, status), and the spec is already documented as `AgentInput`. This avoids exposing proto internals that SDK users don't construct directly.
- **Shared types** like `ApiResourceReference` are documented per-page rather than cross-referenced, keeping each doc page self-contained.
- **Internal annotations** (`@internal`) in proto comments are stripped from rendered descriptions, consistent with existing behavior.

## Benefits

- SDK users can now click any parameter type to see exactly what fields they need to provide
- Consistent UX across all type references in method documentation
- Self-contained pages — no cross-page navigation needed to understand parameter types
- Zero manual maintenance — method types are automatically extracted from protos during codegen

## Impact

- **17 SDK reference pages** updated with clickable proto types
- **17 service schema JSON files** enriched with method type definitions
- **3 source files** modified in the codegen pipeline
- All pre-commit hooks (Prettier, Vale) pass on regenerated docs

---

**Status**: ✅ Production Ready
