# Design Decision 003: Fixed Virtual Viewport for Demo Responsiveness

**Date**: 2026-04-16
**Status**: Implemented
**Task**: T01

## Context

Demo containers used `clamp(320px, 55vh, 380px)` for height, which made
internal layout dimensions change with the browser viewport. Cursor and
scroll interactions computed positions against one container size, but
at different viewport widths the interactions landed in wrong places.

## Decision

Adopt the same fixed virtual viewport pattern that `DemoVideo.tsx`
already uses for Remotion export. All interactive demos render at a
canonical 896×380 layout internally; `DemoViewport` applies CSS `zoom`
to scale the canonical layout into the available page width.

### Key choices

1. **Canonical docs viewport: 896×380** — matches Tailwind `max-w-4xl`
   (56rem) and `DEMO_SHELL_HEIGHT`. At desktop widths the demo looks
   identical to before (zoom = 1).

2. **CSS `zoom`, not `transform: scale()`** — consistent with
   `DemoVideo.tsx`; `Cursor.tsx` already corrects for zoom via
   `cRect.width / container.offsetWidth`; zoom changes layout geometry
   so the outer container wraps naturally without height math.

3. **Minimum zoom: 0.5** — prevents the demo from shrinking below
   ~448×190px on very narrow screens. The real narrow-container
   responsive strategy (poster fallback, breakpoint system) is a
   DemoScope product decision.

4. **Detail demos excluded** — the 4 static detail demos use
   `DEMO_DETAIL_CLASSES`, have no cursor/scroll interactions, and
   weren't affected by the responsiveness bug. `DemoViewport` API is
   compatible if they need it later.

5. **Video-export passthrough** — when `isVideoExport` is true,
   `DemoViewport` renders a simple wrapper and defers sizing to
   `DemoVideo.tsx`, avoiding zoom compounding or `--demo-shell-height`
   conflicts.

## Consequences

- T02 (Resize-Aware Scroll Recovery) is resolved by T01 — the fixed
  viewport means scroll positions never become stale on resize.
- All shell views (AppShell, ManagementShell, etc.) require zero
  changes — they use `var(--demo-shell-height, ...)` which
  `DemoViewport` overrides to `380px`.
- `Cursor.tsx` and `scroll-utils.ts` require zero changes.
- New `DemoViewport` component becomes part of the DemoScope public
  API surface (T09).
