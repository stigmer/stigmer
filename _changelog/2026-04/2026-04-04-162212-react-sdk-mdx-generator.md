# React SDK MDX Documentation Generator

**Date**: April 4, 2026

## Summary

Built a complete TypeDoc-to-MDX documentation generator for the React SDK (`@stigmer/react`), producing always-in-sync per-domain reference pages with hook signatures, component props, and type definitions. The generator transforms TypeDoc JSON into 17 Fumadocs MDX pages covering 67 hooks and 59 components, fully integrated into the existing `make protos` build pipeline.

## Problem Statement

The React SDK overview page documented the existence of 67 hooks and 59 components across 16 domains, but individual hook signatures, component props, and type definitions were only accessible by reading source code. Developers had no searchable, browsable reference documentation for the React SDK.

### Pain Points

- No auto-generated per-domain reference pages for hooks and components
- Hook signatures, parameter types, and return shapes required reading source TSDoc
- Component props interfaces not surfaced in documentation
- No CI check to detect stale documentation after SDK changes
- Manual documentation would immediately drift from the rapidly evolving SDK

## Solution

A six-module TypeScript generator pipeline that reads TypeDoc JSON and produces deterministic MDX pages using Fumadocs components (`TypeTable`, code blocks, frontmatter). The generator classifies exports by kind (hooks, components, utility functions, type aliases, interfaces), groups them by domain (derived from source file paths), resolves cross-references, and renders structured MDX with inline associated types.

## Implementation Details

### Generator Architecture (`site/scripts/generate-react-sdk-docs/`)

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `typedoc-types.ts` | 249 | Strict TypeDoc JSON v2 schema types, zero `any` |
| `model.ts` | 89 | Domain model: Domain, Hook, Component, TypeDef, Field |
| `parser.ts` | 732 | TypeDoc JSON → domain model transformation |
| `mdx-utils.ts` | 210 | Type serialization, MDX escaping, comment rendering |
| `renderer.ts` | 197 | Domain model → MDX page strings |
| `index.ts` | 92 | Entry point: read JSON, run pipeline, write files |
| **Total** | **1,569** | |

### Key Design Decisions

- **Generator location**: `site/scripts/` (not `tools/codegen/`) — aligns with existing TS site tooling convention
- **Inline associated types**: Props and return interfaces rendered directly under their hook/component, not in a separate section — matches React component library conventions (Radix, Chakra)
- **Domain classification**: Source file path after `sdk/react/src/` determines domain; external re-exports (proto types) excluded
- **Deterministic output**: Alphabetical ordering of hooks, components, types; identical input always produces identical output

### Generated Output

- **17 domain pages** (6,994 lines of MDX total): agent, agent-instance, api-key, attachment, composer, core, environment, error, execution, github, library, mcp-server, models, organization, session, skill, workspace
- **`meta.json`** with sidebar ordering
- **`index.mdx`** — the hand-written React SDK overview (moved from `docs/sdk/react.mdx` for Fumadocs folder page convention)

### Makefile Integration

Refactored `gen-sdk-docs` into a composite target:

```
make protos → gen-sdk-docs → gen-proto-sdk-docs + gen-react-sdk-docs
```

Each generator also has an independent CI staleness check (`gen-proto-sdk-docs-check`, `gen-react-sdk-docs-check`).

### Edge Cases Resolved

- **Utility functions**: camelCase non-hook functions classified as TypeDefs with extracted signatures (not misclassified as components)
- **Re-exported enums**: Proto enums (Kind 8/16) silently skipped
- **Invalid JS identifiers**: Props like `aria-label` auto-quoted in TypeTable objects
- **Fumadocs sidebar**: `react.mdx` moved to `react/index.mdx` to enable nested folder navigation

## Benefits

- **Always in sync**: `make protos` regenerates React SDK docs alongside proto docs
- **CI-verifiable**: `gen-react-sdk-docs-check` catches stale docs before merge
- **Zero manual maintenance**: 17 pages, ~7,000 lines of MDX auto-generated from TSDoc
- **Developer ergonomics**: Hook signatures, parameters, return types, and examples all on one page per domain
- **Type-safe generator**: Full TypeDoc JSON typing, no `any`, graceful degradation for missing TSDoc

## Impact

- **SDK users**: Can browse per-domain reference pages with full hook signatures and component props
- **SDK maintainers**: TSDoc comments in source are the single source of truth — no separate docs to maintain
- **CI pipeline**: Staleness checks prevent documentation drift
- **Site maintainability**: Generator follows existing site tooling patterns (tsx scripts, yarn commands)

## Related Work

- **T01**: TypeDoc setup and proof of concept (prerequisite)
- **T02**: TSDoc coverage audit and writing guidelines (prerequisite)
- **T04** (next): Wire sidebar navigation and update overview page links
- **T05** (next): TSDoc backfill for under-documented interfaces
- **Parent project**: 20260403.03.sdk-docs-auto-generation

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~3 hours)
