# Move Runner Picker from Toolbar to Configure Menu

**Date**: April 27, 2026

## Summary

Relocated the `RunnerPicker` from the always-visible composer toolbar (Tier 1) into the Configure menu (Tier 2), surfacing the selection as a removable context chip and persisting the runner preference across sessions via localStorage. This fixes the toolbar crowding caused by long runner names and aligns runner selection with its correct information architecture tier.

## Problem Statement

When a runner with a long name was selected (e.g., `sureshs-mac-studio-local`), the runner picker pill dominated the composer toolbar, pushing other controls and breaking visual balance. This affected both the desktop app and the web console since both consume `SessionComposer` from `@stigmer/react`.

### Pain Points

- Long runner names truncated awkwardly and still consumed too much horizontal space
- Toolbar became visually crowded: Workspace, Attach, Configure, Runner pill, Model pill, Send
- Runner was given more visual prominence than agent selection (which was behind Configure), despite being a lower-frequency decision
- Runner selection did not persist across sessions, requiring re-selection every time

## Solution

Moved runner selection into the Configure menu alongside Agent, MCP Servers, Skills, and Session Variables — all session-level configuration concerns. The toolbar now only shows per-message controls (Workspace, Attach, Configure, Model, Send).

### UX Design Rationale

- **Frequency of change**: Runner changes at most 1x per session (like Agent), not per-message (like Model). Tier 2 is the correct placement.
- **Cognitive category**: "Where does my code run?" is infrastructure/setup, same category as "Which agent?" and "Which MCP servers?"
- **Progressive disclosure (Hick's Law)**: Runner picker is no longer visible during message composition when irrelevant.
- **Internal consistency (Jakob's Law)**: Runner now follows the same pattern as its Tier 2 peers.

## Implementation Details

All changes are internal to `@stigmer/react`. The public `SessionComposerProps` API is unchanged.

- **`ContextChip.tsx`**: Added `"runner"` to the chip type union and label map
- **`icons.tsx`**: Added `RunnerIcon` (CPU/chip SVG matching the one in `RunnerPicker`)
- **`ComposerToolbar.tsx`**: Removed all runner-specific props and rendering; simplified `hasExecParams` to just `showModelSelector`
- **`SessionComposer.tsx`**: Added runner to `configureItems` (between Skills and Session Variables), added `"runner"` case to `renderConfigPanel`, added runner context chip to the chips area when a runner is selected
- **`useNewSessionFlow.ts`**: Added `stigmer:session:runner` localStorage key with restore-on-mount and persist-on-change effects (same pattern as model persistence)

## Benefits

- Clean, balanced toolbar regardless of runner name length
- Runner selection persists across sessions — set once, remembered
- Consistent information architecture — all session-level configuration behind Configure
- Zero changes needed in web console or desktop app launcher pages
- No public API breakage — `ComposerToolbar` is not exported from the SDK barrel

## Impact

- **Desktop app**: Toolbar is cleaner; runner appears as a chip when selected
- **Web console**: Same improvement, automatically via shared SDK
- **Platform builders**: `SessionComposerProps` unchanged; runner selection still works via `runnerId`/`onRunnerIdChange`

## Related Work

- `20260422.01.runner-ux-cli-restructure` — Runner picker was originally added in T08
- `20260426.01.desktop-web-ux-parity` — Desktop/web alignment project

---

**Status**: Production Ready
