# Task T03: Ink SDK Reference Documentation and Integration Guide

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Infrastructure + Content

## Objective

Set up the full documentation pipeline for `@stigmer/ink` (TypeDoc quality gate, auto-generated reference, hand-written integration guide) mirroring the proven `@stigmer/react` pattern.

## Context

### Current State of `@stigmer/ink`
- 13 public exports in `sdk/ink/src/index.ts`: provider, transport helpers, 10 components, 2 composed views
- Good TSDoc comments on most exports (summaries, `@example` blocks, `@link` cross-references)
- A `stigmer-ink` CLI binary
- **No** TypeDoc config, no doc generation, no README, no docs site pages, no coverage checks
- CLI integration working: `run_stream_ink.go` spawns `@stigmer/ink` via npx

### Analog: React SDK Pipeline
```
sdk/react/typedoc.json              → sdk/ink/typedoc.json
sdk/react/tsdoc.json                → sdk/ink/tsdoc.json
sdk/react/tsconfig.typedoc.json     → sdk/ink/tsconfig.typedoc.json
sdk/react/scripts/tsdoc-coverage.ts → sdk/ink/scripts/tsdoc-coverage.ts
site/scripts/generate-react-sdk-docs/ → site/scripts/generate-ink-sdk-docs/
docs/sdk/react/index.mdx (hand-written) → docs/sdk/ink/index.mdx (hand-written)
docs/sdk/react/*.mdx (generated) → docs/sdk/ink/*.mdx (generated)
```

## Task Breakdown

### Step 1: TypeDoc Setup in `sdk/ink`

Create:
- `sdk/ink/typedoc.json` — entry point `src/index.ts`, JSON output to `dist/api.json`, `excludeInternal`, `requiredToBeDocumented` for all public symbol kinds, `externalSymbolLinkMappings` for `@stigmer/react` and `@stigmer/sdk`
- `sdk/ink/tsdoc.json` — extends `typedoc/tsdoc.json`
- `sdk/ink/tsconfig.typedoc.json` — extends `tsconfig.json`, excludes tests

Add `package.json` scripts:
- `typedoc:json` — produces `dist/api.json`
- `tsdoc:check` — `typedoc --treatValidationWarningsAsErrors`
- `tsdoc:coverage` — coverage analysis script

### Step 2: TSDoc Gap-Fill in Source

Run `tsdoc:check` and fix any validation errors. Ensure every public export has:
- Non-empty summary
- `@param` docs (for functions/components with parameters)
- `@example` block (for provider, transport, and key components)

Add barrel-level comments to `src/index.ts` categorizing the exports (Provider, Transport, Components, Composed Views).

### Step 3: TSDoc Coverage Script

Create `sdk/ink/scripts/tsdoc-coverage.ts` adapted from `sdk/react/scripts/tsdoc-coverage.ts`:
- Categories: Provider, Transport, Components, Composed Views (instead of React's domain-based grouping)
- Same metrics: summary coverage, example coverage, field-level coverage for Props interfaces

### Step 4: Docs Generator

Create `site/scripts/generate-ink-sdk-docs/`:
- `index.ts` — reads `sdk/ink/dist/api.json`, writes `docs/sdk/ink/*.mdx` + `docs/sdk/ink/meta.json`
- `parser.ts` — TypeDoc JSON → domain model (categories: provider-and-transport, components, composed-views)
- `renderer.ts` — MDX: frontmatter, signature blocks, `<TypeTable>` for props, `@example` code blocks

Add `generate-ink-sdk-docs` script to `site/package.json`.

### Step 5: Hand-Written Integration Guide (`docs/sdk/ink/index.mdx`)

Sections:
1. What `@stigmer/ink` is — terminal UI components for Stigmer agent sessions
2. When to use it — custom CLIs, terminal dashboards, extending Stigmer CLI rendering
3. Install — `npm install @stigmer/ink @stigmer/sdk @stigmer/protos ink react`
4. Quick start — minimal `SessionApp` example
5. Provider and transport — `InkStigmerProvider` vs `StigmerProvider`, `createNodeTransport`/`createNodeClient`
6. Using React SDK hooks — all `@stigmer/react` hooks work under `InkStigmerProvider`
7. Composing custom views — using individual components for custom terminal UIs
8. CLI integration story — how Go CLI spawns Ink, how to replicate in your own CLI
9. Link to auto-generated reference

### Step 6: Wire into Docs Site

- Add `"ink"` to `docs/sdk/meta.json` pages array
- Update `docs/sdk/index.mdx` to mention Ink SDK alongside React SDK

### Step 7: Makefile and CI

Add to root `Makefile`:
- `gen-ink-sdk-docs` target
- `gen-ink-sdk-docs-check` target
- Add to `gen-sdk-docs` and `gen-sdk-docs-check` umbrella targets

Add to CI workflow.

## Success Criteria

- [ ] `tsdoc:check` passes with zero warnings
- [ ] `tsdoc:coverage` reports 100% summary coverage on public exports
- [ ] `docs/sdk/ink/` has auto-generated reference pages
- [ ] `docs/sdk/ink/index.mdx` hand-written integration guide published
- [ ] Ink SDK appears in docs SDK sidebar
- [ ] `make gen-ink-sdk-docs-check` passes in CI

## Files Touched

- `sdk/ink/typedoc.json` (new)
- `sdk/ink/tsdoc.json` (new)
- `sdk/ink/tsconfig.typedoc.json` (new)
- `sdk/ink/package.json` (add scripts)
- `sdk/ink/scripts/tsdoc-coverage.ts` (new)
- `sdk/ink/src/*.ts(x)` (TSDoc gap-fill)
- `site/scripts/generate-ink-sdk-docs/` (new)
- `site/package.json` (add script)
- `docs/sdk/ink/index.mdx` (new, hand-written)
- `docs/sdk/ink/*.mdx` (new, auto-generated)
- `docs/sdk/ink/meta.json` (new, auto-generated)
- `docs/sdk/meta.json` (add `ink`)
- `docs/sdk/index.mdx` (mention Ink)
- `Makefile` (add targets)

## Dependencies

- T01 should be complete so the docs/cli/ nav structure is established
- Ink SDK API surface should be stable (CLI modernization project substantially done)
