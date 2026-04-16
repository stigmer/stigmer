# Task T03: Expand Playwright Viewport Coverage

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Testing
**Depends on**: T01

## Problem

Current Playwright config tests only two viewports:
- `desktop` (1280x800)
- `ipad` (iPad Pro 11)

This misses the viewport sizes where responsiveness issues manifest.

## Proposed Fix

Add three new Playwright projects to `site/playwright.config.ts`:

| Project | Viewport | Rationale |
|---------|----------|-----------|
| `mobile` | 375x667 | iPhone SE — smallest common mobile viewport |
| `small-desktop` | 1024x600 | Small laptop / split-screen — where `55vh` creates the most shrinkage |
| `tablet-portrait` | 768x1024 | iPad portrait — tests vertical layout pressure |

### Implementation

1. Add the three new projects to `playwright.config.ts`
2. Generate screenshot baselines at the new viewports (after T01 fix is in place)
3. Verify all demo tests pass at all five viewports
4. Update CI configuration if needed to run the expanded test matrix

## Success Criteria

- Playwright runs demo tests at 5 viewports: desktop, ipad, mobile, small-desktop, tablet-portrait
- All tests pass at all viewports
- Screenshot baselines exist for all contracted steps at all viewports
