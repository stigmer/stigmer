# Fix Cross-Org Library Resource Navigation

**Date**: March 26, 2026

## Summary

Library detail pages for skills, agents, and MCP servers returned "not found" when a user viewed a public resource owned by a different organization. The Console's URL scheme only encoded the resource slug, causing the detail page to query the viewer's active org instead of the resource's owning org. This change introduces GitHub-style `[org]/[slug]` URLs and fixes all navigation entry points.

## Problem Statement

When browsing the library in "All" scope, the list correctly displays public resources from other orgs. Each `SearchResult` includes `org`, `slug`, and `qualifiedSlug`. However, clicking a resource navigated to `/library/skills/${item.slug}` — discarding `item.org`. The detail page resolved `org` via `useActiveOrgSlug()` (the viewer's own org) and called `getByReference({ org: viewerOrg, slug })`. The backend correctly scoped the query, so a skill owned by org `stigmer` was not found when queried under a different org.

### Pain Points

- Public skills, agents, and MCP servers from other orgs were completely inaccessible via the library UI
- The "Skill not found" error message was misleading — the resource existed but the wrong org was being queried
- URLs were ambiguous — `/library/skills/agent-creator` did not encode which org owned the resource
- Cross-resource links (e.g., clicking a skill reference from an agent detail page) suffered the same bug

## Solution

Encode the resource's owning org in the URL using GitHub-style `[org]/[slug]` route segments. This aligns with the existing `qualifiedSlug` concept (`org/slug`) already present in the domain model and is familiar to the developer audience (Jakob's Law).

**New URL pattern**: `/library/skills/stigmer/agent-creator` instead of `/library/skills/agent-creator`

## Implementation Details

### Route restructuring

Moved all three resource detail routes from `[slug]/` to `[org]/[slug]/`:

- `client-apps/web/src/app/library/skills/[org]/[slug]/`
- `client-apps/web/src/app/library/agents/[org]/[slug]/`
- `client-apps/web/src/app/library/mcp-servers/[org]/[slug]/`

Updated `generateStaticParams` to emit both `org` and `slug` placeholders for static export compatibility.

### Detail page components

Replaced `useActiveOrgSlug()` with `useStaticRouteParam("org", 2)` in all three detail pages (`SkillDetailPage`, `AgentDetailPage`, `McpServerDetailPage`). The `org` now comes from the URL — the resource's owning org — not the viewer's active org.

### useStaticRouteParam enhancement

Added a backward-compatible `fromEnd` parameter to `useStaticRouteParam` so multi-segment dynamic routes (`[org]/[slug]`) can resolve each parameter from the correct URL position during static export fallback. Existing single-param callers are unaffected (default `fromEnd=1`).

### Navigation entry points

Updated all five navigation entry points to include `item.org` or `ref.org` in the URL:

- Three list pages: `SkillListPage`, `AgentListPage`, `McpServerListPage`
- Two cross-resource callbacks in `AgentDetailPage`: `onSkillClick` and `onMcpServerClick`

### Breadcrumb fix

Updated `LibraryBreadcrumb` to skip intermediate non-category segments (the org slug) to avoid rendering a breadcrumb item with a broken link. The breadcrumb now renders `Library / Skills / Agent Creator` cleanly.

### SDK JSDoc

Updated the usage example in `AgentDetailView.tsx` to show `org` in the URL pattern, guiding platform builders to use the correct pattern.

## Benefits

- Public resources from other orgs are now accessible via the library UI
- URLs are canonical, shareable, and unambiguous — they fully identify a resource
- The URL scheme matches the domain's `qualifiedSlug` concept
- No SDK or backend changes required — the fix is purely in Console URL wiring

## Impact

- **Users**: Can now browse and view public resources from any org in the library
- **URLs**: Breaking change from `/library/skills/[slug]` to `/library/skills/[org]/[slug]` — acceptable at this stage since no public URL contract exists
- **SDK**: Zero functional changes. Only a JSDoc example update in `AgentDetailView`
- **Backend**: Zero changes

## Related Work

- Search/list APIs already returned `org` per item — this fix ensures the Console uses it
- The `qualifiedSlug` field (`org/slug`) in `SearchResult` proto was already designed for this pattern

---

**Status**: Production Ready
