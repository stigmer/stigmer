# Single Active Demo Playback

**Date**: April 14, 2026

## Summary

Added single-active-player coordination and viewport-based auto-pause to the demo engine. Only one `ScenarioPlayer` can play at a time, and a playing demo pauses automatically when scrolled out of view. Both features are disabled in video export mode.

## Problem Statement

Documentation pages can contain multiple demos (e.g., `connect-tools.mdx` has three). When a reader started demo A, scrolled down, and started demo B, both demos continued playing simultaneously — overlapping narration audio, consuming animation cycles off-screen, and creating a confusing experience.

### Pain Points

- No coordination between `ScenarioPlayer` instances — each managed its own `playbackState` as local React state
- A demo continued animating and narrating after scrolling entirely out of view
- Overlapping narration audio from two demos was disorienting

## Solution

Two complementary mechanisms, both internal to `ScenarioPlayer` with zero API surface change.

## Implementation Details

### PlaybackCoordinator (module-level singleton)

Created `PlaybackCoordinator.ts` — a plain TypeScript module with no React dependency. It maintains a `Map<string, PauseCallback>` of registered players.

- Each `ScenarioPlayer` registers on mount and unregisters on unmount.
- When a player starts playing, it calls `notifyPlaying(id)`, which invokes the pause callback on every other registered player.
- The pause callback uses a functional state updater (`prev === "playing" ? "paused" : prev`) so it only transitions from playing to paused — idle and already-paused states are not disturbed.

### Viewport auto-pause (IntersectionObserver)

Each `ScenarioPlayer` creates an `IntersectionObserver` on its container element with `threshold: 0.5`. When less than 50% of the container is visible, the observer fires and transitions the player from playing to paused. This matches the standard threshold used by YouTube and Vimeo for embedded players.

No auto-resume on scroll-back — the user must click to restart playback. Auto-resume would be disorienting and would violate browser autoplay policy for audio.

### Video export safety

Both the coordinator registration and the `IntersectionObserver` guard on `isVideoExport`. In Remotion, there is exactly one player per composition and no viewport scrolling, so both features are correctly skipped.

### What does NOT change

- No changes to any scenario component (`index.tsx` files)
- No changes to MDX pages or the MDX component map
- No changes to `useNarrationPlayback` — audio already responds to `playing` becoming false
- No changes to the layout, providers, or page shell
- No new props on `ScenarioPlayer`

## Benefits

- Only one demo plays at a time — no overlapping narration audio
- Off-screen demos stop consuming animation cycles and audio resources
- Zero integration burden — existing and future scenarios inherit the behavior automatically
- No React context or provider plumbing required

## Impact

- **All `ScenarioPlayer`-based demos** — single-active-player and viewport auto-pause apply universally
- **Pages with multiple demos** — `connect-tools.mdx`, `create-agent.mdx`, `first-skill.mdx`, `quickstart.mdx` all benefit immediately
- **Video export** — unaffected (both features are disabled under `isVideoExport`)

## Related Work

- `_changelog/2026-04/2026-04-14-140746-demo-engine-resilience-and-playback-speed.md`: Playback speed control and narration sync
- `_changelog/2026-04/2026-04-09-195939-video-style-demo-player-redesign.md`: ScenarioPlayer video-style controls

---

**Status**: ✅ Production Ready
**Files changed**: 1 modified (`ScenarioPlayer.tsx`), 1 new (`PlaybackCoordinator.ts`)
