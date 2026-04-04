# SDK reference: enums, commons page, and cross-page type links

**Date**: April 4, 2026

## Summary

The SDK docs codegen pipeline now documents protobuf enums with value tables, hosts curated shared types on a **Commons** page, and links resource pages to that page for `ApiResourceMetadata`, `ApiResourceKind`, `ApiResourceVisibility`, audit types, and related enums. Resource-specific enums stay on their resource pages; duplicated audit sections were removed in favor of a single commons definition.

## Problem Statement

After making nested status and method types clickable, two gaps remained: enum fields rendered as plain strings with no anchor or valid values, and commons types (`ApiResourceMetadata`, visibility, kind, audit structs) either had no documentation or were repeated on many pages.

### Pain Points

- No `### EnumName` sections, so `TypeTable` could not link enum field types.
- Shared commons messages and enums were not a single source of truth in the reference.
- `ApiResourceAudit*` blocks were identical across multiple resource pages.
- Method **Returns** / **Parameters** lines could still point at commons types with same-page anchors that did not exist after deduplication.

## Solution

**Phase 1 — Enums:** `proto2schema` emits `enumTypes` on each `ServiceSchemaFile`; `sdk_docs.go` renders markdown tables per enum and extends field link helpers for `TypeSpec.EnumType`.

**Phase 2 — Commons:** `extractCommonsSchema` writes `schemas/services/commons.json`; codegen emits `docs/sdk/commons.mdx` and adds `commons` to `docs/sdk/meta.json`. Resource pages use `/docs/sdk/commons#anchor` in `typeDescriptionLink` and in method return/parameter refs where the type lives on commons. Commons enums are not re-listed at the bottom of resource pages.

## Implementation Details

- **`tools/codegen/proto2schema/main.go`**: `EnumSchema` / `EnumValueSchema`, `collectEnumTypes` (FQN-deduped, recursive message walk), `CommonsSchemaFile`, `extractCommonsSchema` with curated message/enum allowlists, dedupe when the same enum appears from multiple proto files.
- **`tools/codegen/generator/sdk_docs.go`**: `docWriteEnumTypes`, `docEnumTypeName`, commons-aware writers (`*WithCommons`), skip commons types in method-type and status-nested rendering when documented on commons, `docTypeRefWithCommons` for Methods section.
- **`tools/codegen/generator/sdk_client.go`** (and TS/Python/Java loops): skip `commons.json` like `search.json` so it is not treated as a resource client.
- **Generated artifacts**: `docs/sdk/commons.mdx`, updated `*.mdx` resource pages, `tools/codegen/schemas/services/*.json` including `enumTypes` and `commons.json`.

## Benefits

- Readers see valid enum values next to the API surface that uses them.
- One place for metadata, kind, visibility, and audit shapes; less TOC noise on resource pages.
- Fumadocs `TypeTable` already supports absolute `typeDescriptionLink` targets; no UI component change required.

## Impact

- **Docs consumers**: Clearer SDK reference; clickable paths from Agent (and others) to Commons for shared types.
- **Maintainers**: Regenerate with `proto2schema --comprehensive` then `make gen-sdk-docs` (or equivalent generator invocation).

## Related Work

- `_changelog/2026-04/2026-04-04-095410-clickable-proto-types-in-sdk-docs.md`
- `_changelog/2026-04/2026-04-04-103438-clickable-status-nested-types-in-sdk-docs.md`

---

**Status**: Production ready (regenerate docs after proto or commons list changes)  
**Timeline**: Multi-phase codegen + doc regen
