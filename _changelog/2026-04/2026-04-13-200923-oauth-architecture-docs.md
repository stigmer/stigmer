# OAuth Architecture Explanation Page

**Date**: April 13, 2026

## Summary

Created the OAuth architecture explanation page — the final guide in the
`guides/integrations/` section. The page explains the three architectural layers
behind Stigmer's OAuth system: how OAuth apps are resolved, where credentials
are stored, and how tokens stay fresh. This completes the integration guides
section (T01–T05).

## Problem Statement

The OAuth for tools (T03) and BYOA (T04) guides both cross-link to an OAuth
architecture page that explains the internals. Without this page, platform
builders who want to understand *why* the system behaves as it does — why
removing a BYOA override breaks existing grants, why tokens refresh
automatically, how the storage model provides a security boundary — have nowhere
to go.

### Pain Points

- T03 and T04 defer architectural depth to a page that didn't exist yet
- Platform builders need to understand the resolution chain to make informed
  decisions about BYOA overrides
- The two-layer credential storage model (grant metadata vs encrypted tokens)
  is non-obvious and deserves an explicit explanation

## Solution

A Diataxis Explanation page with three mermaid diagrams, organized around the
three promises made by the T03 and T04 cross-links:

1. **Resolution chain** — Flowchart showing the DCR vs vendor OAuth decision
   tree and the three-level resolution (org override, platform default, none)
2. **Credential storage** — Diagram showing the OAuthGrant/Managed Environment
   split and the security boundary rationale
3. **Token lifecycle** — State machine showing connect, pre-flight, auto-refresh,
   failure, and re-auth transitions

## Implementation Details

### Files created

| File | Purpose |
|------|---------|
| `docs/guides/integrations/oauth-architecture.mdx` | Explanation page |
| `_projects/.../tasks/T05_0_plan.md` | Task plan |

### Key architectural content documented

- **Resolution chain**: Org BYOA override → platform default → none. Evaluated
  fresh at connect time AND every token refresh. This is the key insight that
  explains BYOA's immediate effect and grant breakage on override removal.
- **Storage split**: OAuthGrant (non-secret: expiry, client_id, token_endpoint)
  vs Managed Environment (secrets: access token, refresh token). Security
  boundary — pre-flight checks never touch the secret store.
- **Token lifecycle**: Four health states (healthy, expired-refreshable, expired,
  no-grant) mapping to the UI states documented in the OAuth for tools guide.
- **BYOA impact**: Capstone section tying all three layers together, including
  why removing an override breaks grants (refresh uses currently resolved
  OAuthApp, not the one from the original grant).

### Design decisions

- **No demo**: Mermaid diagrams are the right medium for architecture. The UI
  interactions are already demoed in T03 (OAuth connect) and T04 (BYOA setup).
- **Explanation type**: The only non-how-to page in the integrations section,
  serving as the architectural capstone.
- **Platform builders only**: External reviewer (Slack marketplace) audience
  deferred to a future project.

## Benefits

- Closes the cross-link loop from T03 and T04
- Platform builders can understand the resolution chain, storage model, and
  token lifecycle without reading proto comments
- The BYOA capstone section explains the non-obvious grant breakage behavior
- Three mermaid diagrams provide visual architecture understanding

## Impact

- Completes the `guides/integrations/` section (T01–T05)
- All five pages are now live: overview, connect from marketplace, OAuth for
  tools, BYOA, and OAuth architecture
- No existing files modified — all cross-links and navigation entries were
  already in place from T01–T04

## Related Work

- [OAuth BYOA Proto Layer](_changelog/2026-04/2026-04-13-130208-oauth-byoa-proto-layer.md) — Proto foundation
- [OAuth Apps Settings Page](_changelog/2026-04/2026-04-13-184626-oauth-apps-settings-page.md) — Settings UI
- Project: `20260413.02.mcp-integration-docs` — T05 of the integration docs project

---

**Status**: ✅ Production Ready
