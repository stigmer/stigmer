# Demo Marketplace Icon Rendering

**Date**: April 14, 2026

## Summary

Added icon URLs to the marketplace connect tour demo fixtures so that MCP server cards display their real brand icons (GitHub, Slack, PostgreSQL, etc.) instead of falling back to the generic MCP server glyph.

## Problem Statement

The marketplace grid in the "Connect from the marketplace" demo rendered all MCP server cards with a generic gray square containing a faint two-rectangle SVG glyph, rather than the recognizable brand icons users see in the real product.

### Pain Points

- The `SearchResult` fixtures in `marketplace-connect-tour/steps.ts` never set `iconUrl`
- The `SearchResultOverrides` interface in the SDK demo helpers didn't expose `iconUrl`, making it impossible for any demo to pass icon URLs through `samples.searchResult()`
- The PostgreSQL server spec used in the detail-view steps also lacked `iconUrl`, so the header icon was missing too
- Combined with video compression and the demo zoom level, the thin-stroke fallback SVG was nearly invisible, leaving only the muted background square

## Solution

Wired `iconUrl` through the SDK demo sample factory and populated every marketplace fixture with the corresponding seedpack SVG URL — the same pattern already used by the OAuth connect flow demo for GitHub.

## Implementation Details

- **`sdk/react/src/demo/samples.ts`**: Added `iconUrl` to `SearchResultOverrides` and passed it through in `samples.searchResult()`
- **`marketplace-connect-tour/steps.ts`**: Added a `SEEDPACK_ICON_BASE` constant pointing at the raw GitHub-hosted seedpack icons; set `iconUrl` on all 9 grid entries (GitHub, Slack, PostgreSQL, Playwright, Fetch→curl, Sentry, Stripe, Figma, Notion) and on the PostgreSQL `McpServerSpec` used for the detail view

## Benefits

- Marketplace demo cards now display recognizable brand logos matching the real product experience
- The SDK `samples.searchResult()` factory now supports `iconUrl` for any future demo that needs resource icons
- Consistent with the OAuth and BYOA demos that already set `iconUrl` on their server specs

## Impact

Affects the marketplace connect tour demo video and any page embedding it. No runtime or API changes — purely fixture data for documentation demos.

---

**Status**: ✅ Production Ready
