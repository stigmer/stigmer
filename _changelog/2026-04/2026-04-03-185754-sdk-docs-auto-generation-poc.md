# SDK Reference Documentation Auto-Generation (POC)

**Date**: April 3, 2026

## Summary

Built a Go code generator target (`sdk-docs`) that reads existing service and spec JSON schemas and produces MDX reference documentation pages for all SDK resources. The generator produces 17 complete reference pages with SDK code examples in Go, TypeScript, Python, and Java, rendering natively in the Fumadocs documentation site using existing SDKTabs and TypeTable components.

## Problem Statement

SDK reference documentation was entirely manual, making it impossible to keep in sync with the rapidly evolving proto definitions and generated SDK clients. Developers had no single place to look up method signatures, parameter types, or field descriptions across the four SDK languages.

### Pain Points

- No SDK reference documentation existed for any of the 17+ API resources
- Proto comments (the authoritative source of method and field descriptions) were locked inside `.proto` files, invisible to SDK users
- SDK code examples required manual maintenance across 4 languages
- No way to guarantee docs matched the actual SDK API surface

## Solution

Added a new `sdk-docs` target to the existing `stigmer-codegen` Go tool. The generator follows the same pattern as existing SDK generators (`sdk_client_ts.go`, `sdk_client_python.go`, etc.) -- it reads the same JSON schemas produced by `proto2schema` and emits MDX files instead of source code.

## Implementation Details

### New File: `tools/codegen/generator/sdk_docs.go` (570 lines)

The generator handles the full pipeline from schema to rendered page:

- **Entry point** (`runSDKDocsGeneration`): Iterates all service schemas, loads corresponding spec schemas and type schemas, generates MDX pages and a `meta.json` navigation file.
- **Page structure**: Each resource page includes frontmatter, overview, client access example, all methods with SDK code tabs, parameter documentation, and a Types section with nested TypeTable components.
- **Method signature derivation**: Reuses existing helper functions (`isIDType`, `isEmptyType`, `deriveResourceConfig`) to classify methods into 6 input patterns, producing idiomatic SDK call examples for each language.
- **MDX safety**: `docEscapeMDX()` escapes curly braces and angle brackets in proto descriptions that would otherwise break the JSX parser.
- **Description normalization**: `docCleanDesc()` joins multi-line proto comments into readable paragraphs; `docFirstSentence()` extracts the first sentence for scannable TypeTable cells.

### Modified: `tools/codegen/generator/main.go` (+5 lines)

Added `case "sdk-docs":` to the comprehensive switch block, making the generator invocable via:
```
go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk
```

### Generated Output: `docs/sdk/` (17 MDX pages + meta.json)

Each resource gets a complete reference page with:
- Frontmatter (title, description)
- Overview from spec schema description
- Client access example (SDKTabs with Get call in 4 languages)
- All methods with descriptions, SDK signatures, parameter docs, return types
- Types section with TypeTable for input types and recursively documented nested types

### Navigation: `docs/meta.json`

Added "SDK Reference" under a "Reference" separator in the sidebar navigation.

## Benefits

- **17 resource reference pages** generated automatically from proto schemas
- **Always in sync**: Any proto comment change flows through `proto2schema` → JSON schemas → generated MDX
- **Four SDK languages** covered with correct naming conventions (PascalCase Go, camelCase TS/Java, snake_case Python)
- **Rich field documentation**: TypeTable renders field name, type, description, and required/optional status with expandable details
- **Zero new components**: Reuses existing SDKTabs and TypeTable from the Fumadocs UI library

## Impact

- **SDK users**: Can now browse reference documentation at `/docs/sdk/<resource>` for any resource
- **Platform team**: Proto comment improvements automatically improve generated docs
- **Documentation site**: Sidebar now has a complete "SDK Reference" section with 17 resources

## Related Work

- T01 plan: `_projects/2026-04/20260403.03.sdk-docs-auto-generation/tasks/T01_0_plan.md`
- T02 plan: Cursor plan `t02_sdk_docs_poc_fb9231ff.plan.md`
- Next: T03 (template refinement), T04 (edge-case handling), T05 (proto comment audit), T07 (Makefile/CI integration)

---

**Status**: ✅ POC Complete (T02) -- Validated in Fumadocs dev server
**Timeline**: Single session (~3 hours)
