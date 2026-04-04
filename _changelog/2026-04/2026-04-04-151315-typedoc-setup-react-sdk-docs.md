# TypeDoc Setup for React SDK Docs Auto-Generation

**Date**: April 4, 2026

## Summary

Configured TypeDoc 0.28 as the type extraction layer for the React SDK
(`@stigmer/react`) documentation pipeline. TypeDoc now produces a structured
JSON representation of all 354 public exports — 159 functions (hooks and
components), 159 interfaces, 29 type aliases, and 7 variables — from the
barrel file in ~3 seconds. This is the foundation for auto-generating
per-domain Fumadocs MDX reference pages in a later task.

## Problem Statement

The React SDK has 67 hooks, 59 components, and 192 source files with
substantial TSDoc coverage, but no tooling to extract that documentation
into structured data. The existing proto-based SDK docs generator
(`sdk_docs.go`) produces MDX from JSON schemas — we need an equivalent
extraction step for the TypeScript source.

### Pain Points

- No way to extract TSDoc comments, signatures, and type info from the
  React SDK source programmatically
- Can't verify whether existing TSDoc coverage is sufficient for doc
  generation without a concrete extraction tool
- No validated data model to design the MDX generator against

## Solution

Added TypeDoc as a devDependency with a minimal configuration targeting
the public API barrel file (`src/index.ts`). Created a dedicated
`tsconfig.typedoc.json` to isolate doc generation from test compilation.
Ran the tool and produced a comprehensive analysis of the JSON output.

## Implementation Details

### Files Added/Modified

- `sdk/react/package.json` — added `typedoc@^0.28.18` devDep and
  `typedoc:json` script
- `sdk/react/typedoc.json` — TypeDoc config (entry point, JSON output,
  exclusion settings)
- `sdk/react/tsconfig.typedoc.json` — extends base tsconfig, excludes
  test files from TypeDoc's compilation scope

### Key Configuration Decisions

- **Entry point**: `src/index.ts` barrel — TypeDoc follows re-exports to
  resolve full type info from original source files
- **`excludeExternals: true`** — suppresses re-exported types from
  `@stigmer/protos` and `@stigmer/sdk` (5 types). The generator will
  link to the existing proto-based resource pages instead.
- **`skipErrorChecking: true`** — bypasses 5 pre-existing TS errors
  (3 in test files, 2 in `systemEnvVars.ts` from SDK interface drift)
- **Output**: `dist/api.json` — ephemeral artifact, gitignored via `dist/`

### JSON Output Analysis

| Category | Count | TSDoc Coverage |
|----------|------:|---------------:|
| Functions (hooks + components) | 159 | 98.7% |
| Interfaces (props + return types) | 159 | 20.1% |
| Type Aliases | 29 | 82.8% |
| Variables | 7 | 57.1% |
| **Total** | **354** | **57.6%** |

Domain grouping via `sources[0].fileName` is reliable — 18 domains
detected, matching the SDK's folder structure. `@example` blocks are
present on 116 of 354 exports.

## Benefits

- Validated that TypeDoc extracts everything the MDX generator needs:
  signatures, parameter types, return types, TSDoc descriptions, `@example`
  blocks, and source file paths for domain grouping
- Identified the exact TSDoc coverage gap: interface-level summaries
  (20.1%) vs function-level summaries (98.7%)
- Established the data contract for the MDX generator (T03)
- 3-second generation time means the pipeline can run in CI without
  material cost

## Impact

This is T01 of the React SDK docs auto-generation sub-project
(`20260404.01.sp`). It unblocks:
- T02: TSDoc coverage audit (now has concrete coverage data)
- T03: MDX generator script (now has a validated JSON schema to consume)

## Related Work

- Parent project: `20260403.03.sdk-docs-auto-generation`
- Proto-based SDK docs generator: `tools/codegen/generator/sdk_docs.go`
- React SDK overview page: `docs/sdk/react.mdx` (completed in parent T06)

---

**Status**: Complete
**Timeline**: ~30 minutes
