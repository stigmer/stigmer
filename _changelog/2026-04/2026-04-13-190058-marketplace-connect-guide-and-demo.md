# Marketplace Connect Guide and Demo

**Date**: April 13, 2026

## Summary

Created the "Connect from the marketplace" how-to guide with a 6-step interactive demo showing the full browse-to-connect journey. The demo uses realistic fixture data drawn from real seedpack entries (GitHub, Slack, PostgreSQL, Figma, etc.) rendered in the production card grid layout. This is the first guide page in the `docs/guides/integrations/` section.

## Problem Statement

The `guides/integrations/` section was created in T01 with a hub page (`overview.mdx`) and sidebar navigation, but no actual guide content existed. The hub page links to `connect-from-marketplace` as the first guide — the primary entry point for platform builders discovering tools on the marketplace.

### Pain Points

- No documentation covering the marketplace browsing and tool connection workflow
- Existing demos (`connect-playback`, `connect-tools-tour`) use a fictional "order-management-api" — no demo showed the real marketplace browsing experience
- The `ResourceListPage` demo view only supported list layout, while the production web app recently switched to a card grid for MCP servers
- No demo used `layout="grid"` on `ResourceListView`, creating a gap between docs demos and the production UI

## Solution

Created a complete how-to guide with a hero demo that walks through: browsing a realistic marketplace grid → selecting PostgreSQL → viewing server details → clicking Connect → seeing discovered tools → reviewing approval classifications. Extended `ResourceListPage` with a `layout` prop so demos can match the production card grid.

## Implementation Details

### Guide Page (`connect-from-marketplace.mdx`)

Diataxis type: How-to guide. Concepts/how-to register (Stigmer terms as proper nouns, no tutorial-style hand-holding). Nine sections covering the full marketplace-to-agent workflow:

1. Intro with prerequisite callout
2. Hero demo placement (follows federation/overview pattern)
3. Browse the tool library — categories table from real seedpack CONTRIBUTING.md
4. Connect action — 3-step process (discover, classify, store)
5. What changes — tools tab and policies tab explained
6. Authentication patterns — 3-pattern table with forward links to T03/T04
7. Wire to Agent — `mcp_server_usages` YAML example using PostgreSQL
8. What's next — bridges to OAuth and BYOA guides

### Demo Scenario (`marketplace-connect-tour`)

6-step `ScenarioPlayer` playback with `Cursor` overlay:

| Step | View | What it shows |
|------|------|---------------|
| 1 | Card grid (9 servers) | Marketplace browsing with real entries |
| 2 | Cursor selects PostgreSQL | Card selection interaction |
| 3 | McpServerDetailView (unconnected) | Transport, env requirements |
| 4 | Cursor clicks Connect | The Connect action |
| 5 | Connected — tools tab | 5 discovered tools |
| 6 | Connected — policies tab | execute_sql requires approval |

### Fixture Data

**Grid fixtures** — 9 `SearchResult` entries from real seedpack: GitHub (developer-tools), Slack (communication), PostgreSQL (databases), Playwright (web-automation), Fetch (search), Sentry (monitoring), Stripe (payments), Figma (design), Notion (productivity).

**Detail fixture** — Full `McpServer` for PostgreSQL with stdio transport (`uvx postgres-mcp`), `POSTGRES_CONNECTION_URL` env var, 5 discovered tools (query, list_tables, describe_table, explain_query, execute_sql), and `execute_sql` flagged for human approval.

### ResourceListPage Enhancement

Added optional `layout` prop (type `ResourceListLayout` from `@stigmer/react`) to the demo `ResourceListPage` view. Passes through to `ResourceListView` — existing demos unchanged (defaults to `"list"`), marketplace demo uses `"grid"`.

### Bug Fix

Fixed MDX comment syntax in `overview.mdx` — HTML comments (`<!-- vale ... -->`) are not valid in MDX; changed to `{/* vale ... */}` matching the pattern in federation guides.

## Benefits

- Platform builders now have a complete guide for the marketplace-to-connect workflow
- Demo uses real server names and descriptions — readers recognize tools they actually use
- Card grid layout matches the production web app (no disconnect between docs and product)
- PostgreSQL as the connect example is relatable without being trivial (env var auth, stdio transport)
- Clean separation: T02 covers browse + connect; OAuth depth deferred to T03/T04

## Impact

- **Docs site**: New guide page appears in sidebar under Guides → Integrations → Connect from the marketplace
- **Demo framework**: `ResourceListPage` now supports grid layout via `layout` prop
- **Video export**: Scenario registered in `registry.ts` for automated video generation
- **T03/T04 readiness**: Forward links established; fixture patterns reusable for OAuth demos

## Related Work

- T01: Concepts expansion + nav setup (`41d301e3d`) — created the integrations section and expanded tools.mdx
- Card grid layout (`2026-04-13-171427`) — the production change this demo now mirrors
- `connect-playback` scenario — existing connect flow demo (credential form UX)
- `mcp-server-creation-tour` scenario — existing library list demo (list layout pattern)

---

**Status**: ✅ Production Ready
**Files Changed**: 11 (3 created, 7 modified, 1 task plan)
