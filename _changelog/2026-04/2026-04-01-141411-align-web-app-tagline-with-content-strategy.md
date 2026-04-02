# Align Web App Tagline with Content Strategy Positioning

**Date**: April 1, 2026

## Summary

Updated the Stigmer web app (console) metadata to use the same tagline and description established by the content strategy positioning work. The web app previously used an older, pre-content-strategy tagline that was inconsistent with the sales website.

## Problem Statement

The web app (`client-apps/web`) displayed "Stigmer — Agents for Your Platform" as its browser tab title, while the sales website (`site/`) used "Stigmer — Build agents that work for your business" — the tagline derived from the Phase 1 positioning document. This created an inconsistent brand voice across Stigmer's web properties.

### Pain Points

- Browser tab hover on the web app showed a different tagline than the sales website
- The web app tagline ("Agents for Your Platform") predated the content strategy project and didn't reflect the refined positioning
- The meta description also diverged between the two properties

## Solution

Updated `client-apps/web/src/app/layout.tsx` metadata to match the canonical tagline and description from `site/src/lib/constants.ts` (`SITE_CONFIG`).

## Implementation Details

- **File changed**: `client-apps/web/src/app/layout.tsx`
- **Title**: `"Stigmer — Agents for Your Platform"` → `"Stigmer — Build agents that work for your business"`
- **Description**: `"Embed AI agents into your platform. SDKs, sandboxing, and orchestration — ready to integrate."` → `"Open-source AI agent platform that lets you turn domain knowledge and tools into agents your applications can call via API."`

## Benefits

- Consistent brand messaging across all Stigmer web properties
- Web app metadata now reflects the positioning established in Phase 1 of the content strategy project
- Users see the same value proposition regardless of which Stigmer property they visit

## Impact

- **Web app users**: Browser tab title and meta description now match sales website positioning
- **SEO**: Consistent meta descriptions across properties reinforce a unified brand

## Related Work

- Phase 1 positioning document (`_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md`)
- Phase 2 sales website implementation (tagline in `site/src/lib/constants.ts`)

---

**Status**: ✅ Production Ready
