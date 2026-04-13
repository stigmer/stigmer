# BYOA Guide and Hero Demo (T04)

**Date**: April 13, 2026

## Summary

Added the "Bring Your Own OAuth App" how-to guide with a 6-step hero demo showing the end-to-end BYOA setup flow. The guide covers both motivating scenarios (vendor approval blocked, tighter scope control) and walks an org admin through overriding the platform's OAuth app on a Slack MCP server. Alongside, the OAuthApp client is now exported across all SDK surfaces (TypeScript, Python, Java).

## Problem Statement

The integrations documentation section had three completed guides (marketplace connect, OAuth for tools, overview) but the BYOA page — already linked from the nav and cross-referenced by T02 and T03 guides — was a 404. Org admins hitting vendor-approval-blocked OAuth servers had no documentation path to the BYOA workaround.

### Pain Points

- Cross-links from existing guides pointed to a non-existent page
- The BYOA flow is a critical escape hatch when vendor approval is pending (e.g., Slack's marketplace review) but was undocumented
- No demo existed showing the BYOA dialog, credential entry, and resolution change
- OAuthApp SDK clients were generated but not exported from the public SDK barrel files

## Solution

Created a focused how-to guide with a live demo following the established T02/T03 patterns: real SDK components with fixture data, ScenarioPlayer-based playback with animated cursor, and hand-built UI for the dialog overlay steps.

## Implementation Details

### Guide (`bring-your-own-oauth.mdx`)

- Diataxis type: how-to guide (assumes T03 as prerequisite)
- Sections: intro, when-to-use (two scenarios), 5-step setup walkthrough, what-changes (status text, button label, resolution), remove-and-revert with grant breakage warning, cross-link to T05 architecture
- Shorter than T02/T03 — focused on a narrow admin-level task

### Demo (`byoa-setup`)

- 6-step playback: Slack detail (vendor approval pending) → cursor clicks BYOA CTA → dialog overlay with credentials form → cursor clicks Save → detail showing "Using your OAuth app" → connected with tools
- Slack fixtures from real seedpack entry (vendor OAuth, HTTP transport, 4 scopes, 5 tools, 2 approval policies)
- Three server variants: blocked (PENDING + PLATFORM), org-app (APPROVED + ORG_OVERRIDE), connected (APPROVED + ORG_OVERRIDE + discovered tools)
- Hand-built dialog overlay within AppShell matching the production native `<dialog>` visual while sidestepping state limitations of fixture-driven demos
- `data-cursor-target="byoa-cta-button"` added to ConnectBar's amber banner for cursor targeting

### SDK Exports

- TypeScript: `OAuthAppClient` type exported from `Stigmer` class
- Python: `OAuthAppClient` and `OAuthAppInput` exported from `stigmer` package
- Java: `OAuthAppClient` accessor added to `StigmerClient`

## Benefits

- All cross-links from T02 and T03 guides now resolve to a real page
- Org admins have a clear, demo-illustrated path to bypass vendor approval blocks
- Grant breakage on override removal is documented with an explicit warning
- The `guides/integrations/` section now covers 4 of 5 planned pages

## Impact

- **Documentation**: `bring-your-own-oauth` is the 4th of 5 integration guides; only `oauth-architecture` (T05) remains
- **SDK**: OAuthApp client is now accessible across all three SDK languages
- **Demo framework**: Establishes the "dialog overlay" pattern for demoing in-app modals without native dialog state

## Related Work

- T03 (OAuth for tools guide) — predecessor guide, cross-links to BYOA
- T02 (Marketplace connect guide) — cross-links to BYOA
- Project `20260413.01` (OAuth BYOA integration) — the backend/proto work this guide documents
- T05 (OAuth architecture) — next guide, linked from BYOA's "What's next"

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
