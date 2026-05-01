# Automated Cursor Pricing Codegen Pipeline

**Date**: May 1, 2026

## Summary

Added a build-time codegen pipeline that generates Cursor model pricing data from official sources — Cursor's published pricing page and the Stigmer proxy's model catalog. This replaces the manually maintained pricing table with an auditable, reproducible `make update-pricing` workflow.

## Problem Statement

The Cursor model pricing table in `model-pricing.ts` was a 60+ line hand-maintained array of per-token rates for ~26 models. Every time Cursor added a model or changed pricing, a developer had to manually look up the rates and update the file — an error-prone process with no auditability.

### Pain Points

- Manual data entry for pricing changes — easy to introduce typos or stale rates
- No traceability from data back to its official source
- Model IDs had to be manually cross-referenced between Cursor's display names and API identifiers
- No validation that prices were consistent or complete

## Solution

A TypeScript codegen script (`scripts/update-pricing.ts`) that:

1. **Fetches Cursor's pricing markdown** from `cursor.com/docs/models-and-pricing.md` — a stable, machine-readable endpoint discovered via Cursor's `llms.txt` sitemap
2. **Fetches the live model catalog** from the Stigmer proxy's `/v1/models` passthrough endpoint using `STIGMER_TOKEN`
3. **Cross-references** pricing rows to proxy models by display name (case-insensitive, exact match)
4. **Excludes** unmatched rows with warnings instead of guessing
5. **Generates** `src/adapter/model-pricing-data.ts` with a `DO NOT EDIT` header, source URLs, and timestamp

The generated data file is committed to the repo as a verified artifact. The logic module (`model-pricing.ts`) imports it, keeping data and computation cleanly separated.

## Implementation Details

- **Markdown parsing over HTML scraping**: Cursor's docs page is a Next.js client-side app — a plain `fetch()` gets a JavaScript shell with no `<table>` elements. The `.md` endpoint returns clean pipe-delimited markdown tables, parsed with simple string splitting. Zero external dependencies (cheerio was removed).
- **Makefile integration**: `make update-pricing` reads the Stigmer token from `~/.stigmer/config.yaml` using `awk`, then invokes the script. No Python or PyYAML dependency.
- **ESM direct-execution guard**: The script's `main()` only runs when invoked directly (`tsx scripts/update-pricing.ts`), not when imported for testing.
- **Comprehensive test suite**: 27 tests covering markdown table extraction, price parsing, display-name link stripping, cross-reference matching, validation, and TypeScript generation.

### Key files

| File | Role |
|------|------|
| `scripts/update-pricing.ts` | Codegen script |
| `scripts/__tests__/update-pricing.test.ts` | Unit tests |
| `src/adapter/model-pricing-data.ts` | Generated pricing data (committed artifact) |
| `src/adapter/model-pricing.ts` | Lookup & cost computation (imports generated data) |
| `vitest.config.ts` | Updated test discovery to include `scripts/` |
| `package.json` | Added `update-pricing` npm script |
| `Makefile` | Added `make update-pricing` target |

## Benefits

- **Auditable**: Every regeneration produces a timestamped file with source URLs
- **Reproducible**: `make update-pricing` is a single command any developer can run
- **Zero new dependencies**: Replaced cheerio HTML parsing with built-in markdown parsing
- **Validated**: Script rejects duplicate model IDs, negative prices, and zero output prices
- **Cross-referenced**: Only models present in both Cursor's pricing page and the live API catalog are included

## Impact

- **Cursor runner service**: Pricing data is now auto-generated rather than hand-maintained
- **Developer workflow**: Model pricing updates are a single `make update-pricing` command
- **Data quality**: Eliminates manual transcription errors and ensures pricing-to-model-ID alignment

## Related Work

- [Dynamic Cursor Model Discovery](2026-05-01-162936-dynamic-cursor-model-discovery.md) — live model catalog fetching that this pipeline's cross-referencing depends on
- [Cursor Proxy Authorization](2026-05-01-132919-fix-cursor-proxy-403-add-execution-authorization.md) — metadata endpoint exemption that allows the script to query `/v1/models` without execution scope

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (design, implementation, debugging HTML→markdown pivot)
