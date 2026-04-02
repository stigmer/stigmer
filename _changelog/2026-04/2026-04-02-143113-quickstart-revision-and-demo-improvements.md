# Quickstart Revision, ScenarioPlayer Improvements, and Vale MDX Compatibility

**Date**: April 2, 2026

## Summary

Rewrote the Getting Started quickstart tutorial with full multi-SDK coverage, improved the ScenarioPlayer auto-replay behavior, fixed an MDX build error caused by HTML comments in JSX context, and resolved vale linter false positives from JSX tag attributes.

## Problem Statement

The quickstart tutorial had minimal content and lacked multi-language SDK examples. The ScenarioPlayer component played once and required a manual replay button — users who scrolled past and came back saw a static final frame. Additionally, the `first-skill.mdx` page failed to build because HTML comments (`<!-- -->`) are not valid in MDX v3, and vale linter directives written as JSX comments (`{/* */}`) were not recognized as vale directives, causing both the original suppression to stop working and new false-positive errors from the directive text itself.

### Pain Points

- Quickstart only covered one SDK language; users of Go, Python, or Java had no guide
- ScenarioPlayer required manual "Replay" button click — no automatic re-entry animation
- `first-skill.mdx` build failure from HTML comment syntax in MDX
- Vale inline directives (`<!-- vale ... -->`) incompatible with MDX's JSX-only comment syntax
- `groupId="sdk-language"` in `<Tabs>` JSX attributes triggered `Vale.Terms` errors (lowercase `sdk`)
- Spaced em-dashes (` — `) triggered `Microsoft.Dashes` and `Google.EmDash` errors despite being an intentional style choice

## Solution

Expanded the quickstart with multi-SDK tabs, fixed the ScenarioPlayer to automatically reset and replay when scrolling in and out of the viewport, removed the non-functional vale JSX comments, and updated the vale configuration to handle MDX/JSX content gracefully.

## Implementation Details

### Quickstart rewrite (630 new lines)
- Added TypeScript, Go, Python, and Java tabs for every code example (project setup, dependencies, session creation, execution)
- Restructured as a step-by-step tutorial with clear progression

### ScenarioPlayer improvements
- Replaced one-shot play + manual replay with intersection-observer-based reset: scrolling out resets `stepIndex` to `-1`, scrolling back in restarts the animation
- Removed the `RotateCcw` replay button and the `observedRef` guard
- Simplified the effect dependencies

### Quickstart playback duplicate message fix
- The `snapshot()` helper now extracts the first human message into `spec.message` (which `MessageThread` synthesizes as a bubble) and excludes it from `status.messages`, preventing duplicate rendering

### Vale configuration for MDX compatibility
- Removed broken `{/* vale Vale.Terms = NO/YES */}` directives from `first-skill.mdx` (JSX comments are invisible to vale)
- Added `TokenIgnores` regex to `.vale.ini` to strip JSX/HTML opening tags before linting — prevents false positives from attribute values like `groupId="sdk-language"`
- Disabled `Microsoft.Dashes` and `Google.EmDash` — spaced em-dashes are the docs' intentional style

### Other changes
- Removed "local" page from Getting Started navigation (`meta.json`)
- Updated doc references: "Cloud quickstart" → "Your first Skill", "web console" → "web app"
- Added light/dark logo SVGs to `site/public/`

## Benefits

- All four SDK languages now have first-class quickstart coverage
- ScenarioPlayer animations replay naturally on scroll re-entry — no user action needed
- Zero vale errors on commit (previously 26 errors blocking the pre-commit hook)
- MDX pages build cleanly with no HTML comment workarounds

## Impact

- **Docs readers**: Complete quickstart experience regardless of language preference
- **Demo components**: More polished, hands-free animation behavior in docs
- **Docs contributors**: No more HTML-comment-based vale workarounds needed in MDX files; vale config handles JSX gracefully

## Related Work

- Previous session: [Skill creation guided tour](2026-04-02-141121-skill-creation-guided-tour-demo.md)
- Previous session: [Real SDK components in guided tour](2026-04-02-142451-use-real-sdk-components-in-guided-tour.md)
- Previous session: [ScenarioPlayer prototype](2026-04-02-102646-session-2-scenario-player-prototype.md)
- Project: `_projects/2026-04/20260402.01.skill-creation-demo-component/`
- Parent project: `_projects/2026-04/20260401.02.sp.getting-started-revision/`

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (Session 3 continuation)
