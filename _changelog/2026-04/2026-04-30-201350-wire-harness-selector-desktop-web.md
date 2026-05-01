# Wire Harness Selector into Desktop and Web Session Launchers

**Date**: April 30, 2026

## Summary

Connected the existing `HarnessSelector` component to both the desktop and web `SessionLauncher` pages, enabling users to choose between the Native and Cursor execution harnesses when creating a new session.

## Problem Statement

The `HarnessSelector` toggle and all supporting state management (`useNewSessionFlow.harness`, `setHarness`, localStorage persistence) were fully implemented in `@stigmer/react`, but neither the desktop app nor the web console passed the required props to `SessionComposer`.

### Pain Points

- Users could not select the Cursor harness from the desktop or web UI
- The `showHarnessSelector` prop on `SessionComposer` defaults to `false`, so the toggle was invisible
- The harness state (`flow.harness`, `flow.setHarness`) was available but unused

## Solution

Added three props to the `<SessionComposer>` call in both launcher pages:

- `showHarnessSelector` — enables the toggle in the composer toolbar
- `harness={flow.harness}` — binds the current harness value
- `onHarnessChange={flow.setHarness}` — wires up the change handler

No new imports or dependencies were needed; all pieces already existed in the SDK.

## Implementation Details

**Files changed:**

- `client-apps/desktop/src/pages/SessionLauncher.tsx` — added harness props to `SessionComposer`
- `client-apps/web/src/domain/session/SessionLauncher.tsx` — same three props added

## Benefits

- Users can now toggle between Native and Cursor harnesses directly from the session creation UI
- Harness preference persists across sessions via localStorage
- Model selection automatically adjusts per-harness (separate storage keys)

## Impact

Desktop and web console users gain access to the Cursor harness execution path introduced earlier in the cursor-harness project.

## Related Work

- `_changelog/2026-04/2026-04-30-180023-sdk-react-session-harness-selector.md` — SDK-level `HarnessSelector` component
- `_changelog/2026-04/2026-04-30-130933-cursor-harness-proto-foundation.md` — `HARNESS_CURSOR` proto enum

---

**Status**: Production Ready
