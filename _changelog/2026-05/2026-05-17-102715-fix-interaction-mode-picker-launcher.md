# Fix InteractionModePicker in SessionLauncher + Dropdown Refactor

**Date**: May 17, 2026

## Summary

Fixed the Plan/Agent interaction mode picker not appearing on the new session creation screen (SessionLauncher) in both web and desktop clients. Also refactored the picker from a segmented control to a scalable dropdown, and fixed a silent bug where mode selection was dropped during new session creation.

## Problem Statement

After implementing the Plan/Agent interaction mode toggle (Phase 4), the mode picker was only visible when sending follow-up messages within an existing session. Users creating a new session from the launcher screen had no way to select Plan mode.

### Pain Points

- Plan/Agent mode picker was missing from the SessionLauncher (new session screen) on both web and desktop
- `useNewSessionFlow.submit` silently dropped `context.interactionMode`, meaning even if the picker were shown, the selected mode would not reach the backend
- The segmented control UI pattern would not scale as additional modes (e.g. Ask) are added

## Solution

Three-part fix: (1) wire the `showInteractionModePicker` prop into both SessionLauncher files, (2) fix the missing `interactionMode` propagation in `useNewSessionFlow`, and (3) refactor the picker from a segmented control to a Popover dropdown with descriptions.

## Implementation Details

**SessionLauncher wiring** (web + desktop): Added `InteractionModeOption` type import, local `interactionMode` state via `useState`, and the three required props (`interactionMode`, `onInteractionModeChange`, `showInteractionModePicker`) to the `<SessionComposer>` component. Mirrors the existing pattern from `SessionPage`.

**useNewSessionFlow fix**: Added `interactionMode: context?.interactionMode` to the `executionFields` object passed to `createExecution`. The `useSessionPageFlow` (follow-up path) already had this wiring correct — only the new-session path was missing it.

**InteractionModePicker refactor**: Replaced the `radiogroup` segmented control with a `@base-ui/react` Popover dropdown. Each option now renders with a label and short description (e.g. "Full tool access — read, write, and execute"). Uses the same Popover pattern as `ModelSelector` for visual consistency. The trigger is a compact text button with a chevron, matching toolbar density.

## Benefits

- Users can now select Plan mode when creating new sessions (not just follow-ups)
- The mode selection is correctly propagated to the backend for new sessions
- The dropdown scales to additional modes without layout changes
- Each mode option includes a description, reducing ambiguity for new users
- Consistent with the toolbar's existing Popover-based controls

## Impact

- **Direct users**: Plan mode toggle now visible on the new session launcher (web + desktop)
- **Data integrity**: Mode selection no longer silently dropped during new session creation
- **UX extensibility**: Dropdown pattern ready for future modes (Ask, etc.)
- **4 files modified** across React SDK and client apps

## Related Work

- Phase 4 Plan/Agent interaction mode (same project session): proto enum, runner enforcement, SDK component, SessionPage wiring
- Cursor IDE's Plan/Ask/Agent mode dropdown (UX inspiration for the dropdown refactor)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
