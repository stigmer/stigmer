# Demo Engine: Type Interaction (Character-by-Character Text Input)

**Date**: April 16, 2026

## Summary

Added `type` as the fifth action type to the demo engine's `useStepInteractions` hook, enabling character-by-character text input simulation in both browser playback and Remotion video export. This replaces scenario-specific input-filling workarounds with a reusable engine primitive. Validated by replacing the one-off `PrefilledCreateForm` component in the `api-key-setup` demo with the engine-level `type` action.

## Problem Statement

Demos that show form input (API key entry, search fields, configuration values) hard-coded the filled state as a separate step. The `api-key-setup` scenario used a custom `PrefilledCreateForm` component that instantly set the input value via the native value setter — effective but visually abrupt. There was no way to show text appearing character-by-character, which is more engaging and clearly communicates "the user is typing."

### Pain Points

- One-off components like `PrefilledCreateForm` duplicated the `nativeInputValueSetter` pattern outside the engine
- Instant fill didn't visually communicate user action — the text just appeared
- No engine-level primitive for text input, forcing each scenario to implement its own approach
- The existing `click` action (T04) proved that engine-level interactive actions are cleaner than per-scenario workarounds

## Solution

Extended the `useStepInteractions` hook with a three-phase `type` action that follows the same architectural pattern established by the `click` action in T04:

- **Phase 1** (at `atPercent`): Cursor animates to the target element
- **Phase 2** (at `atPercent + CLICK_DELAY_MS`): First character appears after the cursor settles
- **Phase 3+** (every `TYPE_CHAR_DELAY_MS`): Subsequent characters appear one at a time

The typing uses the `nativeInputValueSetter` pattern (already proven in `TypingComposer` and `PrefilledCreateForm`) to update React controlled inputs correctly.

## Implementation Details

### Engine changes (`useStepInteractions.ts`)

- Extended `StepAction.type` union: `"scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type"`
- Added optional `text` and `typeDelay` fields to `StepAction`
- **Video path**: Computes character count from elapsed frame time (`Math.floor((elapsed - typingStart) / charDelay) + 1`), tracked per-character in `firedRef` to avoid redundant DOM updates
- **Browser path**: Pre-schedules 1 cursor timer + N character timers upfront (consistent with existing pattern), all cleaned up on effect teardown
- New `resolveInput()` helper: Finds `<input>`/`<textarea>` from a `data-cursor-target` wrapper (self or first descendant)
- New `typeTextIntoTarget()` helper: Extracted `nativeInputValueSetter` pattern into a reusable engine function
- New `warnIfTypingExceedsStep()`: Dev-mode console warning when typing duration exceeds step duration

### Timing constant (`timing.ts`)

- Added `TYPE_CHAR_DELAY_MS = 50` (20 characters/second) alongside existing `CLICK_DELAY_MS = 450`

### Scenario validation (`api-key-setup`)

- Removed the scenario-specific `PrefilledCreateForm` component entirely
- Added `data-cursor-target="apikey-name-input"` wrapper around `CreateApiKeyForm`
- Wired `useStepInteractions` with a `type` action: `{ atPercent: 0.15, type: "type", target: "apikey-name-input", text: "quickstart-key" }`
- Bumped step duration from 2000ms to 2500ms to fit the typing animation budget

## Benefits

- **Reusable engine primitive**: Any scenario can now show character-by-character typing with a single action declaration
- **Consistent pattern**: Three-phase execution mirrors the two-phase `click` pattern — scenario authors learn one model
- **Eliminated one-off code**: `PrefilledCreateForm` removed; its functionality is now a first-class engine capability
- **Dual-path support**: Works in both browser playback (setTimeout) and Remotion video export (frame-driven) with zero additional wiring
- **Dev-mode safety**: Console warnings for missing targets, missing inputs, and timing budget violations

## Impact

- Demo scenario authors can add typing animations with a single `StepAction` declaration
- The `api-key-setup` demo now shows the API key name being typed character-by-character instead of appearing instantly
- All 25 demo scenarios pass validation; 60 functional Playwright tests pass across 3 viewports
- TypeScript compiles cleanly with zero type errors

## Related Work

- T04 (Click Interaction) established the multi-phase action pattern and `firedRef` deduplication — see `2026-04-16-153122-demo-engine-click-interaction.md`
- T01 (Fixed Virtual Viewport) provided the stable coordinate system — see `2026-04-16-143424-fix-demo-responsiveness-fixed-virtual-viewport.md`
- Part of the Demo Framework Hardening project: `_projects/2026-04/20260416.02.demo-framework-hardening/`
- Next: T06 (Hover), T07 (Drag), T08 (Viewport Transition)

---

**Status**: Production Ready
**Timeline**: Single session
