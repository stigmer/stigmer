# Library Breadcrumbs and "Create New" Shortcuts

**Date**: March 20, 2026

## Summary

Enhanced the Library landing page with a pathname-based breadcrumb navigation component in the shared library layout and three "Create New" shortcuts (Agent, Skill, MCP Server) below the resource count cards. Breadcrumbs provide spatial orientation across library sub-pages; shortcuts offer a quick path to resource creation via the SessionLauncher.

## Problem Statement

The Library landing page (T01.10) was functionally complete with three `ResourceCountCard` cards showing live counts and navigation to resource list pages. Two gaps remained:

### Pain Points

- No breadcrumb navigation — sub-pages (`/library/agents`, `/library/skills`, `/library/mcp-servers`) lacked a way to show the user's position in the library hierarchy or navigate back
- No "Create New" affordance — the landing page offered browsing but no path to resource creation

## Solution

Added a lightweight `LibraryBreadcrumb` component to the shared library layout and "Create New" shortcuts as ghost-style links in `LibraryLanding`.

## Implementation Details

**LibraryBreadcrumb** (`client-apps/web/src/app/library/LibraryBreadcrumb.tsx`):
- Derives the breadcrumb trail from `usePathname()` — no prop drilling or context providers needed
- Segment-to-label lookup: `{ agents: "Agents", skills: "Skills", "mcp-servers": "MCP Servers" }`
- Returns `null` on `/library` (no breadcrumb needed on the landing page itself)
- WAI-ARIA Breadcrumb pattern: `<nav aria-label="Breadcrumb">` > `<ol>` > `<li>` with `aria-current="page"` on the current segment
- Forward-compatible: supports arbitrary depth for future nested routes

**Library Layout** (`client-apps/web/src/app/library/layout.tsx`):
- Added `"use client"` directive and renders `<LibraryBreadcrumb />` above children
- Sub-pages (T01.11–T01.13) will automatically get breadcrumbs when they land

**"Create New" Shortcuts** (`client-apps/web/src/app/library/LibraryLanding.tsx`):
- Data-driven via `CREATE_SHORTCUTS` constant: "Create Agent", "Create Skill", "Create MCP Server"
- Rendered as Next.js `<Link>` elements with `Plus` icon from lucide-react
- All navigate to `/` (home/SessionLauncher) for Phase 1
- Phase 3 (T03.3) will add query-param pre-fill so each shortcut auto-selects the corresponding system agent
- Visually secondary to cards: `text-muted-foreground`, ghost hover state (`hover:bg-accent`)

## Benefits

- Sub-pages get breadcrumb navigation for free — no per-page wiring needed
- Users have a clear creation path even before the draft-session pre-fill infrastructure exists
- All new code is Console-only (depends on Next.js routing) — correct SDK boundary
- Zero new SDK exports — no public API surface changes

## Impact

- **Console users**: Can see their position in the library hierarchy and navigate back; can initiate resource creation from the landing page
- **Platform builders**: No impact — all changes are Console-specific, no SDK changes
- **T01.11–T01.13**: Breadcrumbs will appear automatically on agent, skill, and MCP server list pages

## Related Work

- Previous: `2026-03-20-134100-library-landing-page.md` — initial landing page with count cards
- Previous: `2026-03-20-132037-sidebar-library-navigation-link.md` — sidebar Library link
- Next: T01.11–T01.13 — resource list pages that will consume the breadcrumb layout

---

**Status**: Production Ready
