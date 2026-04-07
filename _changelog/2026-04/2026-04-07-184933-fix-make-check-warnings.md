# Fix All `make check` Warnings and Link Checker Failure

**Date**: April 7, 2026

## Summary

Resolved the `make check` exit-code-2 failure (caused by lychee link checker) and eliminated all 272 TypeDoc warnings, 21 Vale prose warnings, and 3 React SDK doc generator warnings. The build pipeline now passes through link checking, prose linting, TypeDoc validation, and SDK doc generation with zero errors and zero warnings.

## Problem Statement

`make check` was failing with exit code 2 and producing nearly 300 warnings across four different tooling layers, creating noise that obscured real issues and blocked CI confidence.

### Pain Points

- **Link checker hard failure**: `https://manage.auth0.com/` returned HTTP 302 (redirect to login), which lychee treated as an error since its `--accept` range excluded 3xx status codes
- **21 Vale prose warnings**: `alex.Ablist` and `alex.Race` rules fired on standard technical vocabulary (`disabled`, `invalid`, `primitive`, `mental`) in auto-generated SDK reference docs
- **~55 TypeDoc `@generated` tag warnings**: Protobuf-generated TypeScript stubs use `@generated` JSDoc tags that TypeDoc didn't recognize
- **~120 missing property documentation warnings**: TypeDoc's `notDocumented` validation flagged every undocumented property on exported interfaces/types
- **~86 external symbol link warnings**: `{@link Session}`, `{@link AgentExecution}`, etc. referenced types from `@stigmer/protos` and `@stigmer/sdk` that TypeDoc couldn't link due to `excludeExternals: true`
- **3 doc generator warnings**: The React SDK doc generator expected `ComponentNameProps` interfaces for all exported components, including propless ones

## Solution

A six-phase approach working from high-impact configuration fixes to mechanical documentation backfill:

1. **Link checker** — Configuration-based exclusion of vendor dashboard URLs
2. **Vale** — Targeted rule suppression for auto-generated content, rewording for hand-written content
3. **TypeDoc tags** — `tsdoc.json` extension for custom block tags
4. **External symbol links** — `externalSymbolLinkMappings` in `typedoc.json`
5. **Props interfaces** — Named interface extraction and generator improvement for propless components
6. **Property documentation** — JSDoc backfill across 20+ source files

## Implementation Details

### Link Checker (Phase 1)

Created `.lychee.toml` with regex-based exclusions for vendor dashboard URLs (Auth0, Okta, Azure Portal, AWS Console, Anthropic Console). These are "open your admin panel" links in how-to guides that always redirect to login — they are not broken. Simplified the `Makefile` and `.github/workflows/ci.docs.yaml` to use `--config .lychee.toml` instead of inline flags.

### Vale Configuration (Phase 2)

Added `alex.Ablist = NO` and `alex.Race = NO` to the `[docs/sdk/**/*.{md,mdx}]` section in `.vale.ini`. These rules fire on legitimate technical terms in SDK reference documentation. For 3 hand-written doc warnings: added an inline Vale directive in `docs/vocabulary.md`, reworded "invalid" to "not accepted" in `docs/sdk/index.mdx`, and reworded "separately" to "in a separate mapping" in `docs/guides/federation/multi-tenant-setup.mdx`.

### TypeDoc Configuration (Phases 3-5)

- Created `sdk/react/tsdoc.json` extending `typedoc/tsdoc.json` with `@generated` as a recognized block tag — zero source file changes needed for proto stubs
- Added `externalSymbolLinkMappings` to `sdk/react/typedoc.json` mapping ~30 symbols from `@stigmer/sdk`, `@stigmer/protos`, and `@stigmer/react` to their documentation URLs or `"#"` for internal-only symbols
- Replaced 3 unresolvable `{@link}` tags with backtick code references where the referenced type wasn't imported in the source file

### Doc Generator Improvement (Phase 6)

- Extracted `McpArgsViewProps` and `McpMetadataRowProps` interfaces from inline types in `McpToolDetail.tsx`
- Added `hasProps` boolean to the `Component` model so the doc generator can distinguish between "missing props interface" (real issue) and "propless component" (valid pattern)
- Exported `CapabilityTab`, `SharedSessionFields`, and `UseResourceSearchOptions`/`UseResourceSearchReturn` to satisfy TypeDoc's `notExported` validation

### Property Documentation Backfill (Phase 4)

Added JSDoc comments to ~120 undocumented properties across 20+ files following `tsdoc-standards.md` patterns:

- Discriminated union variant properties (agent setup phases, MCP server setup phases, path classifications, parsed resources)
- Action union types (agent setup actions, MCP server setup actions)
- Return interface fields (`clearSendError`, `approvalError`, `isLoading`, `streamError`, etc.)
- Props interface fields (`className`, `disabled`, `children`)
- Textarea props spread object fields
- OIDC provider config and variable fields

## Benefits

- **`make check` passes** — the link checker no longer fails on vendor dashboard URLs
- **Zero warnings** — TypeDoc, Vale, and the doc generator all produce clean output
- **Better SDK reference docs** — every exported property now has a JSDoc comment that renders in the generated documentation
- **Smarter doc generator** — propless components no longer produce false-positive warnings
- **Centralized link checker config** — `.lychee.toml` is easier to maintain than scattered inline flags

## Impact

- **CI pipeline**: The `check-links` step no longer fails, restoring confidence in the docs CI job
- **Developer experience**: Running `make check` locally produces clean output — real issues are no longer buried in warning noise
- **SDK consumers**: The generated React SDK reference at `/docs/sdk/react/` now has complete property documentation
- **Future contributors**: The `tsdoc.json`, `externalSymbolLinkMappings`, and `.lychee.toml` patterns are extensible for new proto types, external symbols, and vendor URLs

## Related Work

- React SDK docs auto-generation sprint (`20260404.01.sp.react-sdk-docs-auto-generation`)
- TSDoc standards guide (`_projects/2026-04/.../coding-guidelines/tsdoc-standards.md`)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
