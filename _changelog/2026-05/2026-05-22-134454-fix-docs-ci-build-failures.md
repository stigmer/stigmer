# Fix Documentation CI Build Failures

**Date**: May 22, 2026

## Summary

Resolved three distinct CI failures across the `ci.docs` and `release.website` workflows that were triggered after the unified runner migration. The root causes were an orphaned MDX component reference, missing build steps in CI jobs, and stale SDK documentation output.

## Problem Statement

After the unified runner migration (commits `3ba63bd8b` and `6bfb595a9`), two CI workflows began failing on every push to `main`:

1. `ci.docs.yaml` — both "Lint & Build" and "SDK Docs Freshness" jobs
2. `release.website.yaml` — "pages-build" job (blocks website deployments)

### Pain Points

- Website deployments completely blocked — no docs updates could go live
- SDK Docs Freshness job never had the proto build step, masked by local `dist/` artifacts
- The `DemoRunnerListDetail` component was removed in the runner migration cleanup but its MDX reference was left behind
- `make check` didn't catch these locally because: proto `dist/` already existed from prior builds, and Node.js v23 (local) silently handles undefined MDX components while CI's Node 22 throws

## Solution

Three targeted fixes addressing each failure independently:

1. **Remove orphaned MDX reference** — Deleted `<DemoRunnerListDetail />` from `docs/concepts/runners.mdx`
2. **Add build step to SDK Docs Freshness** — Inserted `npm run build:libs` so proto types are available for TypeDoc
3. **Add dependency install to website release** — Added `npm ci` + `npm run build:libs` so the site can resolve `@stigmer/protos` imports

Additionally regenerated the React SDK typedoc output to capture changes from other conversations.

## Implementation Details

| File | Change |
|------|--------|
| `docs/concepts/runners.mdx` | Removed `<DemoRunnerListDetail />` (line 157) |
| `.github/workflows/ci.docs.yaml` | Added `npm run build:libs` step to `sdk-docs-freshness` job |
| `.github/workflows/release.website.yaml` | Added `npm ci` + `npm run build:libs` before `make build-site` |
| `sdk/react/typedoc-output.json` | Regenerated via `make gen-sdk-docs` |

### Root Cause Analysis

The `@stigmer/protos` package exports only compiled output (`dist/*.js`), but `dist/` is gitignored. CI workflows that skip `npm run build:libs` have no proto artifacts to resolve against. This was never caught locally because developers always have leftover `dist/` from previous builds.

The `DemoRunnerListDetail` component was removed in commit `3ba63bd8b` (unified runner migration cleanup) which deleted the component source, export, and MDX registration — but missed the usage site in the docs.

## Benefits

- Unblocks website deployments to GitHub Pages
- SDK Docs Freshness job will pass reliably on clean CI machines
- Removes a confusing component reference that renders nothing
- Identifies a gap: local `make check` can pass while CI fails due to stale build artifacts

## Impact

- **CI/CD**: Both docs workflows should now pass on the next push to `main`
- **Website**: stigmer.ai deployments unblocked
- **Developer experience**: Cleaner local-to-CI parity understanding

## Related Work

- Unified runner migration (`3ba63bd8b`, `6bfb595a9`)
- Prior commit `a482a5d27` attempted to fix test/lint failures from the same migration

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes investigation and fix
