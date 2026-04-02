# Reduce Documentation Home Page Redundancy

**Date**: April 2, 2026

## Summary

Eliminated triple repetition of "Documentation" / "Docs" on the docs home page by disabling the breadcrumb on the index page and consolidating the page title and body heading into a single, clear content flow.

## Problem Statement

The docs home page displayed the word "Documentation" three separate times:

### Pain Points

- Breadcrumb showed "Docs > Documentation" — redundant on the root page
- Front matter title rendered "Documentation" as the page title
- Body contained a duplicate `# Stigmer Documentation` heading immediately below
- The overall effect felt cluttered and repetitive rather than welcoming

## Solution

Removed redundant layers while preserving all meaningful content:

1. **Disabled breadcrumb on the docs index page** — breadcrumbs add no navigational value on the root page
2. **Removed the duplicate `# Stigmer Documentation` body heading** — the `DocsTitle` component already renders the title
3. **Consolidated the page metadata** — merged the platform tagline into the description and shortened the title to "Stigmer Docs"

## Implementation Details

### `site/src/app/docs/[[...slug]]/page.tsx`

- Added `isIndex` check (`!params.slug || params.slug.length === 0`)
- Conditionally set `breadcrumb: { enabled: false }` on the index page
- Sub-pages retain their existing breadcrumb with `includeRoot` and `includePage`

### `docs/index.mdx`

- Title: `Documentation` → `Stigmer Docs`
- Description: absorbed the platform tagline ("open-source AI Agent platform…")
- Removed the `# Stigmer Documentation` heading and the repeated paragraph from the body
- Cards and sections remain unchanged

## Benefits

- Cleaner, less cluttered docs home page
- Single clear title instead of three overlapping labels
- Description now carries the full platform pitch in one place
- Sub-page breadcrumbs remain fully functional

## Impact

- **Docs home page**: Visually cleaner, reduced cognitive load
- **Sub-pages**: No change — breadcrumbs still work as before
- **SEO**: Title and description updated but remain descriptive

---

**Status**: ✅ Production Ready
