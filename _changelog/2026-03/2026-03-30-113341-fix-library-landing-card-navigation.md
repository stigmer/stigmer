# Fix Library Landing Card Navigation — Eliminate Full-Page Reload on Resource Cards

**Date**: March 30, 2026

## Summary

Fixed the Library landing page resource cards (Agents, Skills, MCP Servers) to use client-side navigation instead of triggering full browser reloads. The cards were rendering as plain `<a href>` elements without an `onClick` handler, bypassing the SPA routing that the rest of the Console uses.

## Problem Statement

After the client-side library navigation work was completed, the Library landing page (`/library`) still caused full-page reloads when clicking the Agents, Skills, or MCP Servers count cards. Every card click reloaded auth, config, org data, sidebar, and the SDK client from scratch — creating a noticeably sluggish experience compared to the instant transitions elsewhere in the Console.

### Root Cause

`LibraryLanding.tsx` passed only `href` to `ResourceCountCard` — no `onClick` handler. The SDK component correctly renders `<a href>` when given `href` alone (for accessibility: right-click, status bar URL preview). Without an `onClick` that calls `preventDefault` and uses `router.push`, every click followed the native anchor behavior: a full document navigation.

The `ResourceCountCard` component was already designed for this SPA pattern — its JSDoc explicitly documents combining `href` with `onClick` + `preventDefault` for client-side routing. The landing page simply wasn't using it.

## Solution

Added an `onClick` handler to each `ResourceCountCard` in `LibraryLanding.tsx` that intercepts plain left-clicks and uses Next.js `router.push()` for client-side navigation. Modifier-clicks (Cmd/Ctrl/Shift/middle-click) pass through for "open in new tab" behavior.

## Implementation Details

### Modified File

- **`client-apps/web/src/app/library/LibraryLanding.tsx`** — Added `useRouter` from `next/navigation`, a `handleCardClick` callback using the `isPlainClick` guard pattern (same as the sidebar's session items), and passed `onClick={handleCardClick(card.href)}` to each `ResourceCountCard`.

### Key Design Decision: `router.push` vs. extending `LibraryNavigationProvider`

The target routes (`/library/agents`, `/library/skills`, `/library/mcp-servers`) are pre-rendered static routes — unlike detail pages (`/library/agents/[org]/[slug]`), they don't need the custom pushState mechanism. Next.js `router.push()` handles client-side transitions between static routes that share a layout natively. The breadcrumb component already uses `<Link>` for these same paths, confirming the framework handles them correctly.

### No SDK Changes

`ResourceCountCard` in `@stigmer/react` was not modified — its `href` + `onClick` API was already designed for this exact use case. Routing logic stays in the Console consumer, not the SDK component, which is correct per the layered architecture.

## Benefits

- **No full-page reloads** when navigating from Library landing to resource list pages
- **Consistent experience** across all Console navigation — landing cards now match the sidebar, breadcrumbs, and detail transitions
- **Preserved accessibility** — `href` attribute retained for right-click, Cmd+click, status bar URL preview

## Impact

- **End users**: Library landing feels responsive and instant, matching the rest of the Console
- **Platform builders**: No impact — zero SDK changes
- **Architecture**: Console-only fix, no new patterns introduced

## Related Work

- [Client-Side Library Navigation](2026-03-30-111200-client-side-library-navigation.md) — the broader library navigation overhaul this fix completes

---

**Status**: ✅ Production Ready
**Timeline**: ~10 minutes
