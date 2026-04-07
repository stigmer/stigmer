# Browser Mockup Zoom Token System

**Date**: April 7, 2026

## Summary

Introduced a dedicated zoom and height token system for BrowserView demo shells, fixing over-sized browser mockups in both the documentation site and exported videos. Also removed a false `BrowserPageCard` shared component that abstracted scenario-specific content under a misleadingly generic name.

## Problem Statement

Browser mockups (Acme login page, auth dashboards, signup forms) in the documentation website and extracted videos appeared too zoomed. The login card had no visible top/bottom margins — it filled the entire browser content area, making it look cramped rather than like a real web page.

### Pain Points

- Browser mockups dominated the prose on docs pages due to 1:1 zoom
- Login/signup cards had no breathing room (no visible margins above or below the card)
- No centralized mechanism to scale BrowserView shells independently of other demo views
- Video exports inherited the same over-sized proportions
- A `BrowserPageCard` shared component was created as a fix but was a false abstraction — generic name, specific auth-form implementation

## Solution

Added two new tokens and a `zoom` prop to `BrowserView`, creating a complete configuration layer for browser mockup sizing. Identified and removed the `BrowserPageCard` component after recognizing that content inside shells is scenario-specific, not a shared concern.

## Implementation Details

**New tokens in `tokens.ts`:**
- `DEMO_BROWSER_ZOOM = 0.9` — CSS zoom applied to BrowserView shells. At 0.9, browser mockups sit comfortably within docs prose. In video export (2× zoom), effective magnification is 1.8×.
- `DEMO_BROWSER_SHELL_HEIGHT = 420` — taller than the 380px general shell height. At 420px with 0.9 zoom, rendered height is ~378px (nearly identical to original) but internal content area grows from ~314px to ~354px.

**BrowserView changes:**
- Added optional `zoom?: number` prop applied via CSS `zoom` on the outer container
- Changed default height fallback from `DEMO_SHELL_HEIGHT` (380px) to `DEMO_BROWSER_SHELL_HEIGHT` (420px)

**Scenario file changes (5 files):**
- Applied `zoom={DEMO_BROWSER_ZOOM}` to all `BrowserView` instances
- Compacted inline card dimensions (w-56→w-52, p-4→p-3, font sizes reduced by 1px)
- Removed `BrowserPageCard` imports, restored inline JSX with `PulseHighlight`

**Role document update (`_roles/002_document_writer.md`):**
- Documented `DEMO_BROWSER_ZOOM` and `DEMO_BROWSER_SHELL_HEIGHT` tokens
- Added "Shell-level vs. content-level abstraction" design principle

**Deleted:**
- `site/src/components/docs/demos/shared/BrowserPageCard.tsx` — false abstraction removed

## Benefits

- Browser mockups render at a comfortable scale on docs pages — no longer dominate the surrounding prose
- Login/signup cards have visible top and bottom margins, appearing like real web pages
- Single-knob configurability: changing `DEMO_BROWSER_ZOOM` scales ALL browser mockup content proportionally
- Video exports benefit from the same token system via CSS variable override
- Each scenario independently owns its illustration content — free to diverge without fighting a shared component

## Impact

- **Documentation site**: All 5 federation guide pages with browser mockups now render at correct proportions
- **Video export**: Browser mockups in Remotion-generated videos inherit the improved sizing
- **Architecture**: Established a clear design principle — shell components are reusable and tokenized; content inside shells is scenario-specific

## Related Work

- `2026-04-02-181623-centralize-demo-styling-tokens.md` — original demo token centralization
- `2026-04-07-164906-remotion-video-pipeline-fixes.md` — video export sizing fixes
- `2026-04-07-141850-federation-visual-scenarios-and-interaction-framework.md` — federation demo framework

---

**Status**: Production Ready
