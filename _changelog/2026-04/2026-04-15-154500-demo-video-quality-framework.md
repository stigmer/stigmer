# Demo Video Quality Framework

**Date**: April 15, 2026

## Summary

Hardened the demo video generation ecosystem with four systemic improvements: auto-derived visibility contracts from scenario source code, full-containment visibility checks in E2E tests, dev-mode runtime warnings in the engine, and cursor-target alignment validation. Visibility contract coverage jumped from 5 scenarios to 15, with zero manual authoring required for the new ones.

## Problem Statement

Demo videos were shipping with dialogs half off-screen, cursors clicking invisible buttons, and cursor overlays rendering at wrong positions. The BYOA ("Bring Your Own OAuth App") demo was the most visible example — the OAuth credentials dialog appeared cut off at the bottom and the cursor clicked a button the viewer couldn't see.

### Pain Points

- **Visibility contracts were manual and sparse** — only 5 of 25 scenarios had `visibility.json` files, leaving 20 demos with zero targeted visibility assertions
- **Intersection-based visibility** — a target was "visible" if even 1 pixel overlapped its scroll container, so a dialog with only its top border peeking into view passed the test
- **No cursor position validation** — the cursor could render 200px from its target element and tests would pass
- **No dev-mode feedback** — scenario authors got no warnings when building demos with off-screen targets; they only discovered problems after generating videos
- **Multi-demo page bugs** — the visibility spec always clicked the first play button and monitored the first demo container, causing failures and timeouts for 2nd/3rd demos on the same page

## Solution

Four-layer defense system, each catching a different class of issue at a different stage:

1. **Build time** — `validate-demos.ts` auto-derives visibility contracts from scenario source code
2. **Dev mode** — engine runtime warnings in `Cursor.tsx` and `useStepInteractions.ts`
3. **CI gate** — full-containment E2E checks and cursor alignment validation in Playwright

## Implementation Details

### Auto-Derived Visibility Contracts (validate-demos.ts)

Added Check 6 that parses each scenario's `index.tsx` to extract visibility requirements from existing code:

- **`INTERACTIONS` object** — regex-extracts `scroll-to` targets per step. These elements must be visible for scrolling to work.
- **`cursorTargetFor` function** — regex-extracts switch cases mapping view names to cursor target IDs. Maps view names to step indices via `steps.ts`. Adds `cursorMustAlign` flag for cursor alignment validation.
- **Merges with manual `visibility.json`** — manual entries take precedence per step for overrides and edge cases.

Pattern extraction uses the same level of static analysis the script already does for pixel fonts and zoom tokens — regex matching on consistent code patterns across all 13+ scenarios.

### Full Containment Visibility Checks (demo.spec.ts, demo-visibility.spec.ts)

Replaced intersection-based checks with full containment:

```typescript
// Before: any overlap counts
tr.top < cr.bottom && tr.bottom > cr.top

// After: target must be fully inside container
tr.top >= cr.top - tolerance && tr.bottom <= cr.bottom + tolerance
```

Added 2px tolerance for CSS zoom sub-pixel rounding. Elements without a `data-scroll-container` ancestor are checked against the demo container itself (not the viewport), which is the correct reference frame for demo visibility.

### Dev-Mode Runtime Warnings (Cursor.tsx, useStepInteractions.ts)

**Cursor visibility warning** — after finding a cursor target element, checks whether it's fully contained in its scroll parent. Logs a descriptive warning with element coordinates when the target is off-screen:

```
[Cursor] Target "byoa-cta-button" is not fully visible in its scroll container.
Add a scroll-to interaction before this step, or adjust the content layout.
```

**Scroll/cursor target existence warning** — `executeAction` now warns when `scroll-to` or `set-cursor` targets are not found in the DOM, instead of silently returning.

Both warnings are behind `process.env.NODE_ENV === "development"` and are tree-shaken in production.

### Cursor Alignment Validation (demo-visibility.spec.ts)

For steps with `cursorMustAlign`, verifies the cursor overlay's rendered position is within 25px of the target element's center. Extracts cursor position from framer-motion's CSS transform matrix and compensates for CSS zoom on the container. Catches cursor positioning bugs from zoom miscalculation, timing issues, or layout changes.

### Multi-Demo Page Fixes (demo-visibility.spec.ts)

Fixed `demoIndex`-aware button clicking, container selection, and step monitoring for pages with multiple demos. Previously the spec always targeted the first demo on the page, causing timeouts and false failures for 2nd/3rd demos.

## Benefits

- **3x visibility coverage** — from 5 scenarios with contracts to 15, with zero manual authoring for the new ones
- **Zero-maintenance for new scenarios** — any scenario that declares `cursorTargetFor` or `INTERACTIONS` with `scroll-to` targets gets visibility coverage automatically
- **Catches real bugs** — immediately identified 3 pre-existing visibility issues across `register-idp-playback`, `marketplace-connect-tour`, and `mcp-server-creation-tour`
- **Shift-left feedback** — scenario authors see console warnings during local development, before pushing to CI
- **Stricter assertions** — full containment prevents "partially visible" elements from passing

## Impact

- **Scenario authors**: Get immediate console warnings when building demos with off-screen targets. No need to understand `visibility.json` — coverage is automatic.
- **CI**: `validate-demos` generates enriched manifests with auto-derived contracts. `demo-visibility.spec.ts` runs containment + cursor alignment checks.
- **Video quality**: The framework now catches the class of bugs that caused the BYOA video to ship with cut-off dialogs and mispositioned cursors.

## Related Work

- Previous session established `data-demo-step`, `data-demo-state`, `data-demo-total-steps` attributes and the consolidated test suite
- Visual regression baselines expanded from 5 to 12+ scenarios with the new contracted steps

---

**Status**: Production Ready
**Timeline**: Single session
