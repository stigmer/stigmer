# Task T01: Fix Responsiveness — Fixed Virtual Viewport

**Created**: 2026-04-16
**Status**: DONE
**Type**: Bug Fix + Architecture Improvement

## Problem

Demo containers use a variable height — `clamp(320px, 55vh, 380px)` — which makes the internal layout dimensions change with the browser viewport. Cursor and scroll interactions compute positions against one container size, but when the viewport shrinks (mobile, tablet, split-screen), the content overflows differently and interactions land in the wrong place.

### Root Cause Chain

1. Container height varies between 320px and 380px depending on `55vh`
2. Content inside shells (AppShell, BrowserView, etc.) does not reflow — sidebar is fixed `w-28`, content zoom is fixed `0.82`
3. `scroll-to` fires once via `scrollIntoView({ block: "center" })` and never re-evaluates
4. When the container is shorter, "center" means less margin, and targets may clip
5. Cursor recomputes on resize (ResizeObserver in `Cursor.tsx`), but scroll position is stale
6. No re-scroll on resize in `useStepInteractions.ts`

### Affected Files

- `site/src/components/docs/demos/shared/tokens.ts` — height tokens and clamp expression
- `site/src/components/docs/demos/engine/Cursor.tsx` — already handles zoom; verify with fixed viewport
- `site/src/components/docs/demos/engine/useStepInteractions.ts` — needs ResizeObserver for scroll re-trigger
- `site/src/components/docs/demos/engine/scroll-utils.ts` — verify scrollIntoView works within fixed viewport
- `site/src/components/docs/demos/views/AppShell.tsx` — uses `clamp(320px, 55vh, 380px)`
- `site/src/components/docs/demos/views/BrowserView.tsx` — uses `--demo-shell-height` with fixed height
- `site/src/components/docs/demos/views/ManagementShell.tsx` — same clamp pattern
- `site/src/components/docs/demos/views/TerminalView.tsx` — same pattern
- `site/src/components/docs/demos/views/CodeEditorView.tsx` — same pattern
- `site/src/components/docs/demos/views/APIExchangeView.tsx` — same pattern
- `site/video/compositions/DemoVideo.tsx` — reference implementation (already uses fixed virtual viewport)

## Proposed Fix

Adopt the same **fixed virtual viewport** pattern that `DemoVideo.tsx` already uses for Remotion export, but for the docs site too.

### How DemoVideo.tsx works today

```typescript
const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 540;

// Scales the virtual viewport to fill the composition
const zoom = Math.min(width / VIRTUAL_WIDTH, height / VIRTUAL_HEIGHT);

<div style={{ width: VIRTUAL_WIDTH, height: VIRTUAL_HEIGHT, zoom }}>
  <Component />
</div>
```

The demo always renders at 960x540 internally. CSS `zoom` scales it to fill the output frame. Interactions compute against the stable 960x540 layout, never against variable dimensions.

### Apply the same pattern to the docs site

1. Define a canonical docs viewport in `tokens.ts` (e.g. 896x380 — matches `max-w-4xl` and current `DEMO_SHELL_HEIGHT`)
2. Each demo wrapper renders content at the canonical size
3. CSS `zoom` or `transform: scale()` fits the canonical viewport into the available space
4. The `clamp(320px, 55vh, 380px)` becomes the **outer container** size (how much space the demo occupies on the page), not the internal layout size
5. Cursor and scroll calculations always see the same internal dimensions

### Key consideration

`Cursor.tsx` already accounts for CSS zoom via `cRect.width / container.offsetWidth`. This means the fixed viewport pattern should work transparently — the cursor math already handles the zoom correction. We need to verify this works when the zoom comes from the wrapper rather than from `DEMO_CONTENT_ZOOM` on individual components.

## Implementation Steps

1. Add canonical docs viewport dimensions to `tokens.ts`
2. Create a `DemoViewport` wrapper component that renders children at canonical size with CSS zoom to fit
3. Update `DEMO_PLAYER_CLASSES` wrapper usage in scenarios to use `DemoViewport`
4. Verify `Cursor.tsx` zoom correction works with the new wrapper
5. Verify `scrollIntoView` works correctly inside the zoomed container
6. Add ResizeObserver to `useStepInteractions` for scroll re-trigger on container resize
7. Run all existing Playwright tests to verify no regressions
8. Add `mobile` (375x667) and `small-desktop` (1024x600) Playwright projects
9. Run tests at new viewports to confirm fix

## Success Criteria

- All 25-35 demos render identically at desktop, iPad, mobile, and small-desktop viewports
- Cursor points at the correct target at every viewport size
- Scroll targets are fully visible after `scroll-to` at every viewport size
- Existing Playwright tests pass without baseline regeneration (internal layout unchanged)
- New viewport tests pass

## Risks

- CSS `zoom` on the docs site wrapper may interact with Fumadocs prose layout (margins, max-width). Need to verify the demo still sits cleanly within the page flow.
- If scenarios rely on the container being exactly 380px tall for content fitting, the fixed viewport preserves this. But if any scenario has viewport-aware logic, it would need updating.
- Sub-pixel rendering differences between zoom levels may cause minor visual shifts in screenshot baselines.

## Relationship to Other Tasks

- **T02 (Resize-Aware Scroll Recovery)**: Step 6 above covers this — the ResizeObserver addition is part of this task.
- **T03 (Expand Viewport Coverage)**: Steps 8-9 above cover the Playwright expansion.
- **T04-T08 (New Interactions)**: All new interactions benefit from the fixed viewport because they compute positions against stable dimensions.
- **T09 (DemoScope Extraction)**: The `DemoViewport` wrapper becomes part of the DemoScope public API.
