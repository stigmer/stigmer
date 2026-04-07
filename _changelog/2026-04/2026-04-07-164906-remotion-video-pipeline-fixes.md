# Remotion Video Pipeline: Consistent Sizing, Click Ripple, and Auto-Discovery

**Date**: April 7, 2026

## Summary

Fixed three issues in the Remotion video export pipeline: a CSS layout bug causing different view types to render at different widths, the cursor click ripple animation not triggering in video mode, and a maintenance burden requiring manual registration of new scenarios. Also resolved the "React is not defined" build error that blocked all video rendering.

## Problem Statement

The demo video export pipeline (`make render-videos`) had several issues preventing it from producing consistent, high-quality output:

### Pain Points

- **"React is not defined" build error**: Remotion's esbuild loader compiles JSX to `React.createElement()` calls, but the built-in react-shim loaded *after* user modules, causing a `ReferenceError` at bundle time.
- **Inconsistent component sizing**: The AppShell view appeared significantly narrower than the CodeEditorView in exported videos, despite both targeting the same `max-w-4xl` (896px) width.
- **Missing click ripple in video mode**: The Cursor component's click ripple animation never triggered during Remotion rendering because `setTimeout` doesn't fire in Remotion's frame-by-frame Chromium environment, and the `TimeSourceProvider` created a new context object every frame, resetting state.
- **Manual scenario registration**: Adding a new demo scenario required manually importing its steps and manifest in `Root.tsx` — 10 of 19 available scenarios were not registered.

## Solution

Four targeted fixes, each addressing a distinct root cause:

1. **webpack.ProvidePlugin for React** — Inject `React` as a free variable via webpack so it's available at module initialization time, regardless of entry-point ordering.

2. **`w-full` on the stage card wrapper** — The ring wrapper div in `DemoVideo.tsx` sat inside a `flex-col` container with `mx-auto`, which overrides `align-self: stretch` and falls back to intrinsic content width. Different view types have different max-content widths (CodeEditorView's `whitespace-pre` code lines are very wide; AppShell's `flex-1 min-w-0` content area can be narrow). Adding `w-full` forces `width: 100%` → `max-w-4xl` caps at 896px → all views get identical width.

3. **Timeline-derived clicking state** — Replaced the unreliable `useState`/`setTimeout` clicking mechanism with a render-time derivation: record `targetArrivalMs` when the cursor target changes, then compute `videoClicking = currentTimeMs - targetArrivalMs >= 450ms` every frame. Also stabilized the position effect to depend on `[target, containerRef]` instead of the unstable `timeSource` object.

4. **`require.context` auto-discovery** — Replaced the hardcoded `SCENARIO_DEFS` array with webpack's `require.context` to dynamically discover all `scenarios/*/steps.ts` files and their matching `public/demos/*/manifest.json` narration manifests.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `site/video/webpack.ts` | Added `webpack.ProvidePlugin({ React: "react" })` to plugin chain |
| `site/video/compositions/DemoVideo.tsx` | Added stage card wrapper with `w-full max-w-4xl ring-1 ring-white/[0.06]` |
| `site/src/components/docs/demos/engine/Cursor.tsx` | Split clicking into `browserClicking` (setTimeout) and `videoClicking` (timeline-derived); stabilized position effect deps |
| `site/video/Root.tsx` | Replaced 20 manual imports + `SCENARIO_DEFS` array with `require.context` auto-discovery |

### Key Design Decisions

- **Stage card ring at 6% opacity**: Subtle enough to not compete with view chrome, visible enough to define the boundary against the dark `bg-neutral-950` background.
- **`isVideoRef` pattern in Cursor**: Uses a ref to check video mode inside effects without adding `timeSource` to the dependency array, preventing per-frame re-runs from the unstable context reference.
- **framer-motion over Remotion primitives**: The click ripple uses framer-motion's tween animation (wall-clock time) rather than Remotion's `interpolate`/`spring` (frame-derived time). This avoids adding a Remotion dependency to a shared component while producing acceptable output at 30fps.

## Benefits

- All 19 demo scenarios now render as videos automatically — no manual registration needed
- Every view type (AppShell, CodeEditorView, TerminalView, etc.) renders at exactly 896px width
- Click ripple animation plays correctly in video exports, matching browser behavior
- Video pipeline builds reliably without React reference errors

## Impact

- **Demo pipeline**: `make render-videos` produces 19 consistent, professionally framed MP4 files
- **Developer workflow**: New scenarios are picked up automatically — just add `steps.ts` and the render script finds it
- **Video quality**: Consistent framing across all view types eliminates the perception of size differences between steps within a single video

## Related Work

- `2026-04-03-173643-video-export-pipeline.md` — Original Remotion pipeline setup
- `2026-04-04-145117-remotion-scenario-compositions-and-cursor-fix.md` — Initial cursor position fix for video mode
- `2026-04-04-151137-remotion-programmatic-render-script.md` — Programmatic render script

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours across multiple iterations
