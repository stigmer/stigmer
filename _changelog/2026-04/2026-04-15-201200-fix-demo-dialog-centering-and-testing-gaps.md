# Fix Demo Dialog Centering and Close E2E Testing Gaps

**Date**: April 15, 2026

## Summary

Fixed a CSS height-chain bug that caused dialog overlays to render at the bottom of demo containers instead of the center, affecting 4 demo scenarios. Also closed 4 testing gaps in the Playwright validation so this class of visual bug is caught automatically going forward.

## Problem Statement

Dialog overlays in demo scenarios (BYOA setup, agent creation, MCP server creation, skill creation) rendered at the bottom of the demo shell instead of vertically centered. The "Use your own OAuth app" dialog in the BYOA demo was the most visible example -- the credentials form appeared cut off at the bottom with the cursor clicking in the wrong position.

### Pain Points

- **Dialog at the bottom** -- the `relative h-full` wrapper used for dialog centering did not resolve `height: 100%` correctly because the AppShell content area (`motion.div` with `flex-1`) gets its height from flexbox stretch, which does not always create a definite height for percentage-based children
- **Tests passed while the bug existed** -- the Playwright E2E tests reported green because: dialog steps had no visibility contract, containment checks only verified intersection (not centering), cursor alignment passed because the cursor correctly followed the wrongly-positioned target, and screenshot baselines were created from the broken rendering
- **4 scenarios affected** -- `byoa-setup`, `agent-creation-tour`, `mcp-server-creation-tour`, and `skill-creation-tour` all used the same broken pattern

## Solution

Two-part fix: correct the CSS rendering, then close the testing gaps that let it through.

## Implementation Details

### Rendering Fix

**AppShell content area**: Added `relative` to the `motion.div` content area in `AppShell.tsx`, making it a CSS positioning context. Safe change -- `overflow-hidden` already clips content, so `relative` adds no new behavior for existing scenarios.

**4 scenario overlay patterns**: Removed the `relative h-full` wrapper and replaced with `absolute inset-0` on both children (scrollable content and dialog overlay). Both children now fill the AppShell content area directly via absolute positioning. No `height: 100%` resolution chain needed.

### Testing Gap Closures

**Gap 1 -- Dialog steps had no visibility contract**: Added `data-scroll-target="byoa-dialog-card"` to the BYOA dialog overlay and created a manual `visibility.json` covering the dialog step with a `mustBeCentered` flag.

**Gap 2 -- Containment checks could not catch centering bugs**: Added a `mustBeCentered` field to the visibility contract schema. When present, the E2E test asserts that the target's vertical center is within 20% of the container's vertical center. This directly catches "element pushed to bottom" without being overly rigid about exact pixel positions.

**Gap 3 -- Cursor alignment passed for wrongly-positioned targets**: Resolved by Gap 2 fix. The centering assertion ensures the target is in the right place, making cursor alignment checks meaningful.

**Gap 4 -- Screenshot baselines from broken rendering**: Regenerated all baselines after the rendering fix. Going forward, any regression that moves the dialog off-center fails both the centering assertion and the screenshot pixel diff.

## Benefits

- **Dialog overlays render centered** across all 4 affected scenarios
- **Centering bugs caught automatically** via `mustBeCentered` contract field
- **35/35 tests passing** (25 demo.spec.ts + 10 demo-visibility.spec.ts)
- **Pattern documented** for future scenarios that need centered overlays

## Impact

- **Demo video quality**: The BYOA, agent creation, MCP server creation, and skill creation demos now render dialog/overlay steps with the card properly centered within the shell
- **Future scenarios**: Any scenario author who adds `mustBeCentered` to their visibility contract gets centering validation for free
- **Regression protection**: The screenshot baselines and centering assertions form a two-layer defense against positioning regressions

## Related Work

- Previous session established the demo E2E testing overhaul with auto-discovery and visibility contracts
- Previous session added auto-derived visibility contracts, containment checks, and cursor alignment validation
- The `mustBeCentered` field extends the visibility contract schema introduced in those sessions

---

**Status**: Production Ready
**Timeline**: Single session
