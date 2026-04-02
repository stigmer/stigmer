# Centralize Demo Styling Tokens

**Date**: April 2, 2026

## Summary

Extracted all scattered styling decisions (zoom values, container heights, wrapper class strings) from 13 demo view and scenario files into a single `shared/tokens.ts` constants file, eliminating five ad-hoc zoom values and eight copy-pasted container class strings.

## Problem Statement

The demo system (engine / views / scenarios) had grown to 8 scenarios and 5 views, each independently choosing zoom levels and container classes. When the SettingsView was added for the API key setup scenario, its zoom of `0.75` visually clashed with the `0.82`–`0.88` range used by other views — fonts appeared oversized relative to sibling demos on the same page.

### Pain Points

- Five different zoom values (0.75, 0.82, 0.85, 0.85, 0.88) scattered across five view files with no central authority
- Container wrapper classes (`not-prose mx-auto max-w-4xl`, `stgm not-prose overflow-hidden rounded-lg border border-border`) copy-pasted in eight scenario files
- AppShell height (`380px`) hardcoded with no shared constant
- Adding a new scenario or view required manually replicating patterns — the only feedback loop was visual inspection after the fact

## Solution

Created a single `demos/shared/tokens.ts` file that serves as the source of truth for all demo-specific design values, then updated every view and scenario to import from it.

## Implementation Details

### New file: `site/src/components/docs/demos/shared/tokens.ts`

Defines five constants:

- **`DEMO_CONTENT_ZOOM`** (0.82) — zoom for SDK components in the AppShell content area
- **`DEMO_SIDEBAR_ZOOM`** (0.85) — zoom for widget sidebar components
- **`DEMO_SHELL_HEIGHT`** (380) — AppShell container height in pixels
- **`DEMO_PLAYER_CLASSES`** — container classes for ScenarioPlayer-based demos
- **`DEMO_DETAIL_CLASSES`** — container classes for standalone SDK component demos

### View updates (5 files)

- **ComposerView** — both zoom values (0.82, 0.88) normalized to `DEMO_CONTENT_ZOOM`
- **SettingsView** — 0.75 raised to `DEMO_CONTENT_ZOOM` (0.82), fixing the visual inconsistency
- **SkillsListView** — 0.85 normalized to `DEMO_CONTENT_ZOOM`
- **WidgetsSidebar** — 0.85 sourced from `DEMO_SIDEBAR_ZOOM`
- **AppShell** — hardcoded `h-[380px]` replaced with inline style using `DEMO_SHELL_HEIGHT`

### Scenario updates (8 files)

All eight scenario `index.tsx` files updated to import `DEMO_PLAYER_CLASSES` or `DEMO_DETAIL_CLASSES` instead of inline class strings.

## Benefits

- Adding a new view: import the appropriate zoom constant, done — no guessing which value to use
- Adding a new scenario: import the appropriate container class constant, done — no copy-pasting
- Changing the demo height or zoom: update one number in `tokens.ts` and all 13 files update together
- The SettingsView now renders at the same zoom as all other content views, fixing the original visual inconsistency

## Impact

- **Demo views**: Consistent zoom across all SDK component wrappers
- **Demo scenarios**: Container classes sourced from a single constant
- **Maintenance**: Zero hardcoded zoom values or container class strings remain in the demos directory

## Related Work

- [API Key Setup Demo Scenario](2026-04-02-172448-api-key-setup-demo-scenario.md) — where the SettingsView zoom issue was introduced
- [Demo View Sizing and Fixture Polish](2026-04-02-173536-demo-view-sizing-and-fixture-polish.md) — earlier fix that set the 0.75 zoom
- [Demo Components Three-Tier Architecture](2026-04-02-164409-demo-components-three-tier-architecture.md) — the architecture these tokens serve

---

**Status**: ✅ Production Ready
**Timeline**: Single session
