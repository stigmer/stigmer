# Add Breadcrumb Navigation to Documentation Site

**Date**: March 22, 2026

## Summary

Added breadcrumb navigation with a clickable home link to all documentation pages. Users can now see their location in the docs hierarchy and navigate back to the docs homepage from any page — a basic navigation feature that was previously missing.

## Problem Statement

When browsing the Stigmer documentation site, users on sub-pages (e.g., Getting Started > Installation) had no breadcrumb trail showing their location and no way to navigate back to the docs index page. The only navigation was the sidebar, which on mobile was collapsed behind a menu.

### Pain Points

- No visible path showing current location in the docs hierarchy
- No home/root link to navigate back to the docs index
- Users had to manually edit the URL or use the sidebar to reach the homepage
- Poor navigation UX compared to reference documentation sites like Temporal

## Solution

Enabled Fumadocs' built-in breadcrumb options on the `DocsPage` component: `includeRoot` adds a clickable "Docs" root link and `includePage` displays the current page at the end of the trail.

## Implementation Details

Single file change in `site/src/app/docs/[[...slug]]/page.tsx`:

```tsx
<DocsPage
  toc={page.data.toc}
  full={page.data.full}
  breadcrumb={{
    includeRoot: { url: "/docs" },
    includePage: true,
  }}
>
```

- `includeRoot: { url: "/docs" }` — Prepends a "Docs" link to `/docs` at the start of every breadcrumb trail
- `includePage: true` — Appends the current page name (highlighted) at the end

The breadcrumb system uses Fumadocs' `getBreadcrumbItemsFromPath` from `fumadocs-core/breadcrumb`, which traverses the page tree to build the trail. No custom components needed.

## Benefits

- Users always know where they are in the docs hierarchy
- One-click navigation back to the docs homepage from any page
- Full breadcrumb path is clickable at every segment
- Zero custom code — leverages Fumadocs' built-in breadcrumb system

## Impact

- All documentation pages now display breadcrumbs (e.g., `Docs > Getting Started > Installation`)
- Mobile and desktop users benefit equally
- Consistent with documentation UX patterns seen in Temporal, Docusaurus, and other reference sites

## Related Work

- Part of the documentation infrastructure project (`20260322.01.documentation-infrastructure`)
- Complements Session 6 navigation simplification and Session 7 theme fixes

---

**Status**: ✅ Production Ready
