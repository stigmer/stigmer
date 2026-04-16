# Ink SDK Reference Documentation Pipeline

**Date**: April 16, 2026

## Summary

Established the complete documentation pipeline for `@stigmer/ink` — TypeDoc quality gate, auto-generated API reference, hand-written integration guide, Makefile targets, and CI freshness checks. Mirrors the proven `@stigmer/react` pattern but right-sized for Ink's smaller API surface (15 exports vs React's 100+).

## Problem Statement

`@stigmer/ink` is the terminal UI SDK that powers the Stigmer CLI's session rendering and is available for platform builders creating custom CLIs. Despite having solid TSDoc comments in source, the package had no documentation pipeline: no TypeDoc config, no generated reference pages, no integration guide, no docs site presence, and no CI validation.

### Pain Points

- Users of `@stigmer/ink` had no reference documentation — they had to read source code
- No quality gate on TSDoc comments meant documentation gaps could accumulate silently
- The docs site's SDK section listed only the React SDK, with no mention of the Ink alternative
- No CI check to catch stale generated docs after source changes

## Solution

Built the full documentation pipeline in seven steps, deliberately choosing a single-page reference (instead of the React SDK's multi-page domain split) because Ink's 15 exports don't warrant the fragmentation.

## Implementation Details

### TypeDoc setup (`sdk/ink/`)
- `typedoc.json` — entry point, JSON output, external symbol link mappings to React SDK and proto resource docs
- `tsdoc.json` — extends TypeDoc's base config, registers `@generated` tag for proto stubs
- `tsconfig.typedoc.json` — extends base tsconfig, excludes test files
- Package scripts: `typedoc:json`, `tsdoc:check`, `tsdoc:coverage`

### TSDoc gap-fill
- Baseline showed 100% summary coverage, 97.4% field coverage
- Only two gaps fixed: `TodoListProps.todos` description, `renderMarkdown` `@example`
- Final state: 100% summary, 100% field-level (38/38), `tsdoc:check` passes cleanly

### Coverage script (`sdk/ink/scripts/tsdoc-coverage.ts`)
- Adapted from React SDK's script with Ink-specific categories: Provider, Transport, Components, Composed Views, Utilities
- No domain grouping (Ink has no domain structure)
- Same metrics: summary, example, field-level coverage with markdown table output

### Docs generator (`site/scripts/generate-ink-sdk-docs/`)
- 4 files instead of React's 6 — simpler because it produces a single output page
- `typedoc-types.ts` re-exports shared types from the React generator
- `parser.ts` classifies exports by name into categories (not file-path domains)
- `renderer.ts` produces single `reference.mdx` with category sections + `<TypeTable>` for props
- Re-exports (`createNodeClient`, `createNodeTransport`) render with SDK Overview link

### Hand-written integration guide (`docs/sdk/ink/index.mdx`)
- 7 sections: overview, installation, quick start, provider/transport, React SDK hooks, composing custom views, CLI integration
- Follows Document Writer role's SDK/Reference register
- Key narrative: all `@stigmer/react` hooks work under `InkStigmerProvider`

### Docs site wiring
- `docs/sdk/meta.json` — added `"ink"` after `"react"`
- `docs/sdk/index.mdx` — added Ink SDK card in "What's next"

### Makefile and CI
- `gen-ink-sdk-docs` and `gen-ink-sdk-docs-check` targets
- Wired into `gen-sdk-docs` and `gen-sdk-docs-check` umbrella targets
- `ci.docs.yaml` — added `sdk/ink/**` to path filters

## Benefits

- Developers using `@stigmer/ink` now have complete API reference docs alongside the React SDK
- `tsdoc:check` prevents TSDoc regressions from merging
- `make gen-ink-sdk-docs-check` catches stale generated docs in CI
- Coverage script provides ongoing visibility into documentation health

## Impact

- **End users**: Can now discover and learn `@stigmer/ink` from the docs site instead of reading source code
- **Maintainers**: TSDoc quality gate prevents documentation drift; CI catches stale generated output
- **Platform**: Ink SDK now has first-class documentation presence alongside React SDK

## Related Work

- T01: CLI Reference Documentation (same project, completed in prior session)
- T02: Open-Source Getting Started Path (same project, completed in prior session)
- React SDK documentation pipeline (the proven pattern this mirrors)

---

**Status**: Production Ready
**Timeline**: Single session (~45 min)
