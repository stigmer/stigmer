# Model Selector Visual Density Alignment

**Date**: May 7, 2026

## Summary

Aligned the Model Selector popover's visual density with sibling picker components (AgentPicker, WorkspaceRunnerSelector) in the composer toolbar. The Model Selector appeared visually "bigger" and less compact due to compounding layout inconsistencies — wider popover, thinner font weight, smaller description text, and split badge elements — despite using identical font sizes.

## Problem Statement

Users perceived the Model Selector dropdown as having larger fonts and lower density compared to the Agent and Workspace selectors in the same toolbar. Visual inspection confirmed the feeling was accurate even though all three selectors used `text-xs` (12px) for item labels.

### Pain Points

- Model Selector popover was 32px wider (`w-80` vs `w-72`) than AgentPicker, creating a spacious feel via Gestalt figure-ground effects
- Model names used regular weight (400) while AgentPicker names used `font-medium` (500) always, making model text appear to "float" in its row
- Description text sizes diverged: `text-[0.6rem]` (9.6px) in ModelSelector vs `text-[0.65rem]` (10.4px) in AgentPicker
- Two separate badge spans (speed + cost) on the right edge created visual clutter compared to single-badge rows in other pickers

## Solution

Four targeted CSS/Tailwind class changes in `ModelSelector.tsx` to bring it into visual alignment with the established patterns in AgentPicker and WorkspaceRunnerSelector.

## Implementation Details

- **Popover width**: Changed from `w-80` (320px) to `w-72` (288px) — now matches AgentPicker, SkillPicker, McpServerPicker, and RunnerConfigPanel
- **Font weight**: Moved `font-medium` from the button's conditional `isSelected` class to the model name `<span>` directly — names are now always medium-weight, matching AgentPicker. Selected state continues to be differentiated by `bg-accent` background
- **Description text**: Changed from `text-[0.6rem]` to `text-[0.65rem]` — matches AgentPicker description size
- **Badge consolidation**: Merged two separate `<span>` elements for speed tier and cost tier into a single `<span>` rendering e.g. "Powerful $$$" — reduces right-edge visual elements from 3 to 2

## Benefits

- Visual consistency across all composer toolbar dropdown selectors
- More compact, information-dense Model Selector that matches the established density pattern
- Reduced visual noise from fewer right-edge badge elements per row
- Zero API surface changes — all existing props (`compact`, `showDescriptions`, `showSpeedBadge`) continue to work unchanged

## Impact

- **Affected component**: `@stigmer/react` ModelSelector
- **Affected users**: All users of the SessionComposer (Console and platform builders)
- **Risk**: Purely visual — no logic, props, or API changes. 67 existing tests pass.

## Related Work

- Harness selector compact layout (2026-05 changelog)
- Model registry updates

---

**Status**: ✅ Production Ready
