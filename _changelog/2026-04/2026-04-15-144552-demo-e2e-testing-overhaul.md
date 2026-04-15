# Demo E2E Testing Overhaul

**Date**: April 15, 2026

## Summary

Redesigned the Playwright-based demo testing infrastructure from three redundant spec files (25+ minute estimated runtime) into a consolidated, auto-discovering test suite that runs all 30 tests in under 3 minutes. Visibility contracts are now co-located with scenario source code, and all demos are discovered automatically from MDX files — no hardcoded fixture registries.

## Problem Statement

The documentation site has 25 interactive demo scenarios embedded across 19 pages. These demos include mid-step interactions (scroll-to, set-cursor) that must be verified in a real browser to ensure narration and visual content stay in sync.

### Pain Points

- **Three redundant spec files** (`demo-smoke`, `demo-visibility`, `demo-scroll-coverage`) all navigated to the same pages and played the same demos, tripling runtime
- **No speed acceleration** — demos played at real-time speed, making the suite impractically slow (25+ minute estimate)
- **Hardcoded fixture arrays** duplicated across files — adding a new demo required updating multiple locations
- **Visibility contracts stored far from scenarios** — in `e2e/demos/fixtures/`, separate from the scenario's `index.tsx` and `steps.ts` where the interaction data actually lives
- **Fragile step detection** — used CSS class selectors and time-based estimation instead of data attributes

## Solution

A three-pronged redesign: auto-discovery via build-time manifest, speed acceleration via URL parameter, and co-located visibility contracts.

## Implementation Details

### Auto-Discovery via Build-Time Manifest

Extended `validate-demos.ts` to generate `e2e/demos/demo-manifest.json`:
1. Scans `docs/**/*.mdx` for `<Demo*>` component tags
2. Maps component names to scenario IDs by parsing `src/components/docs/index.ts` exports (avoids fragile PascalCase-to-kebab conversion for acronyms like MCP, OAuth, SSO)
3. Tracks demo index on pages with multiple demos
4. Reads co-located `visibility.json` files and embeds contracts in the manifest
5. Warns about orphaned scenarios (have `steps.ts` but aren't embedded in any docs page)

### Speed Acceleration

Added `__test_speed` URL parameter support to `ScenarioPlayer.tsx`. When present, it overrides the initial `playbackRate`, leveraging the existing mechanism that divides `setTimeout` delays and interaction timing by the rate. Real browser layout and scroll animations still happen — just faster.

- `demo.spec.ts` uses 4x speed (full playback in ~15s per demo)
- `demo-visibility.spec.ts` uses 2x speed (needs more time for mid-step interaction checking)

### Co-located Visibility Contracts

Moved visibility contracts from `e2e/demos/fixtures/*.ts` to `visibility.json` files next to each scenario's `index.tsx`:

```
scenarios/byoa-setup/
  index.tsx          # defines INTERACTIONS with scroll-to targets
  steps.ts           # step sequence
  visibility.json    # declares which targets to verify at which steps
```

The manifest generator picks these up automatically. Adding a new demo with visibility testing requires only dropping a `visibility.json` next to the scenario — no separate fixture directory to maintain.

### Consolidated Spec Files

- **`demo.spec.ts`**: Reads the manifest, tests all 25 demos in one pass each — render, start playback at 4x, check scroll-target visibility at every step, verify completion, assert no JS errors
- **`demo-visibility.spec.ts`**: Reads contracts from the manifest, runs targeted assertions + visual regression screenshots for 5 scenarios with known tricky interactions

Deleted `demo-smoke.spec.ts` and `demo-scroll-coverage.spec.ts`.

### Makefile Integration

- `make check` includes `validate-demos` (fast, catches real issues + generates manifest)
- `make test-demos` / `make check-all` runs the full Playwright suite

## Benefits

- **10x faster**: ~3 minutes wall time (4 workers) vs. 25+ minute estimate
- **Zero maintenance for demo discovery**: Add a `<Demo*>` tag to any MDX page → `validate-demos` picks it up → Playwright tests it automatically
- **Co-located contracts**: Visibility expectations live next to the code they describe, following the principle of proximity
- **Robust step detection**: Uses `data-demo-step`, `data-demo-state`, `data-demo-total-steps` attributes instead of CSS class selectors
- **Orphan detection**: Scenarios with `steps.ts` but no MDX embedding are flagged as warnings

## Impact

- **Developers**: Adding a new demo scenario now requires zero knowledge of the E2E test infrastructure — just create the scenario files and embed in MDX
- **CI**: `make check` stays fast (validate-demos runs in ~3s), while `make check-all` adds the full Playwright gate
- **Quality**: Every demo is automatically tested for scroll-target visibility at every step, catching missing interactions that would cause narration-visual desync

## Related Work

- Previous conversation established `data-demo-step`, `data-demo-state`, `data-demo-total-steps` attributes on ScenarioPlayer
- Visual regression baselines established for 5 scenarios with the initial `toHaveScreenshot()` integration

---

**Status**: Production Ready
**Timeline**: Single session
