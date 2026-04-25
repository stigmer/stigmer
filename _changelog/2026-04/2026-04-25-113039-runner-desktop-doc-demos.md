# Runner and Desktop Documentation Demos

**Date**: April 25, 2026

## Summary

Added interactive Scenar demos to every runner and desktop documentation page that was missing one. Upgraded the existing desktop runner management demo from a static detail view to a full narrated playback. Updated Scenar packages from 0.1.18 to 0.1.19 to fix Node.js v23 TTS compatibility.

## Problem Statement

The desktop-app-promotion project (T01–T11) shipped 7 documentation pages for runners and the desktop app. Only 3 of those pages had interactive demos. The remaining 4 — install guide, CLI local-runner guide, CLI stop-and-cleanup guide — had no visual walkthroughs despite the Document Writer role requiring demos for pages that describe terminal interactions or multi-step workflows.

### Pain Points

- `install.mdx` described the first-launch sign-in flow with no visual reference
- `local-runner.mdx` and `stop-and-cleanup.mdx` covered CLI commands with code blocks but no TerminalView demos
- `manage-runners.mdx` had a demo, but it was a static `RunnerListPanel` render — not a playback showing the multi-step workflow the page describes
- The `edge-tts-universal` TTS dependency was broken on Node.js v23, blocking narration generation

## Solution

Created 3 new Scenar playback scenarios and upgraded 1 existing scenario to narrated playbacks. Updated Scenar to v0.1.19 which includes the `IsomorphicEdgeTTS` fix for Node v23 WebSocket compatibility.

## Implementation Details

### New scenarios

- **`desktop-first-launch`** (4 steps) — DesktopView login screen → BrowserView OAuth → callback redirect → DesktopView sessions. Embedded in `install.mdx`.
- **`local-runner-tour`** (3 steps) — TerminalView `stigmer up` native → Docker variant → `stigmer list runners`. Embedded in `local-runner.mdx`.
- **`stop-runner-tour`** (3 steps) — TerminalView list active → stop one by name → stop all. Embedded in `stop-and-cleanup.mdx`.

### Upgraded scenario

- **`desktop-runner-management`** — Replaced static `RunnerListPanel` in `DesktopView` with a 5-step `ScenarioPlayer` playback: empty runner list → start runner → BrowserView deep link with cursor → second runner appears → stop a runner. Uses dynamic fixture data per step via module-level state + key-based remount.

### Registration

All 3 new components (`DemoDesktopFirstLaunch`, `DemoLocalRunnerTour`, `DemoStopRunnerTour`) exported from `docs/index.ts` and registered in `mdx.tsx`.

### Narration

15 TTS audio clips generated across all 4 scenarios using Scenar CLI v0.1.19 with Edge TTS. Copied to `public/demos/` for static serving.

### Scenar version bump

`@scenar/core`, `@scenar/preview`, `@scenar/react`, `@scenar/cli` updated from 0.1.18 to 0.1.19.

## Benefits

- Every runner and desktop documentation page now has an interactive demo with narration
- Demo coverage for the runner/desktop area went from 3/7 pages (43%) to 7/7 pages (100%)
- The manage-runners demo now shows the full workflow instead of a single static state
- TerminalView demos on CLI pages establish the visual pattern for future CLI documentation

## Impact

- Documentation readers see the first-launch, CLI, and runner management experiences before reading the prose
- Site-wide demo count increased from 28 to 31 registered scenarios, 23 to 26 pages with demos
- Scenar v0.1.19 unblocks narration generation for all future demos on Node.js v23

## Related Work

- Project: `_projects/2026-04/20260424.01.desktop-app-promotion` (T01–T11)
- Scenar v0.1.19: `fix(cli): use IsomorphicEdgeTTS for Node.js v23 WebSocket compatibility`

---

**Status**: ✅ Production Ready
