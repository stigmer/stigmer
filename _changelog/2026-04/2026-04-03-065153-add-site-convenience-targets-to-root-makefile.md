# Add Site Convenience Targets to Root Makefile

**Date**: April 3, 2026

## Summary

Added `run-site`, `build-site`, `clean-build-site`, `preview-site`, and `preview` Make targets to the root Makefile, aligning the Stigmer OSS repo with the openmcf Makefile conventions. This gives contributors a consistent, discoverable set of commands for working with the documentation site.

## Problem Statement

The root Makefile only exposed `site` (dev server) and `docs-build` (production build) as site-related targets. The openmcf monorepo already had a richer set — `run-site`, `build-site`, `preview-site` — and contributors moving between repos had to remember different target names for the same actions.

### Pain Points

- No quick way to preview a production build locally (`preview-site` / `preview`)
- No `clean-build-site` to force a fresh build without manually running two commands
- Target names diverged from openmcf conventions

## Solution

Expanded the `# ─── Site ───` section in the root Makefile with five new targets that delegate to the `site/` sub-Makefile, and rewired the existing `site` and `docs-build` targets to use the new canonical names.

## Implementation Details

- `run-site` → `$(MAKE) -C site dev`
- `build-site` → `$(MAKE) -C site build`
- `clean-build-site` → `$(MAKE) -C site clean` then `$(MAKE) -C site build`
- `preview-site` → `$(MAKE) -C site preview` (builds, then serves `out/` locally)
- `preview` → alias for `preview-site`
- `site` → now delegates to `run-site` (backward compatible)
- `docs-build` → now delegates to `build-site` (removes duplicated recipe)

## Benefits

- One-command local preview of the static production build
- Consistent target names across Stigmer and openmcf repos
- `clean-build-site` removes stale `.next`/`out` artifacts before rebuilding

## Impact

Contributors and CI scripts can now use the same `make preview-site` / `make build-site` vocabulary in both repos. No existing workflows break — `make site` and `make docs-build` still work.

## Related Work

- openmcf root Makefile site targets (the reference implementation)
- `site/Makefile` targets (`dev`, `build`, `preview`, `clean`) remain unchanged

---

**Status**: ✅ Production Ready
