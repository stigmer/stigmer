# Task T02: Marketplace Connect Guide + Demo

**Created**: 2026-04-13
**Status**: IN PROGRESS
**Estimated effort**: 1–2 sessions

## Objective

Write the "Connect from the marketplace" how-to guide with a single cohesive
demo that shows the browse-to-connect journey using realistic fixtures drawn
from real seedpack data, rendered in the production grid layout.

## Scope Adjustments from Original Plan

1. **`overview.mdx` is already written.** T01 delivered a solid hub page.
   Verify consistency after the guide is done, but no rewrite needed.
2. **One cohesive demo, not two separate ones.** Combines `marketplace-browse`
   and `credential-management` into a single `marketplace-connect-tour`.
   Credential management (token lifecycle, BYOA) belongs in T03/T04.
3. **Seedpack as public catalog is out of scope.** Using real seedpack data
   in demo fixtures for authenticity. Live catalog page is a separate initiative.

## Deliverables

### 1. `connect-from-marketplace.mdx` (How-to guide)

Diataxis type: How-to guide. Register: Concepts / how-to.

Sections:
1. Intro — find a tool, connect it, see its tools
2. Prerequisites — concepts/tools familiarity
3. Hero demo — `<DemoMarketplaceConnectTour />`
4. Browse the tool library — card grid, categories, search
5. Connect an MCP server — discovery, classification, approval policies
6. What changes after connecting — tools tab, policies tab
7. Authentication patterns at a glance — env vars, DCR, vendor OAuth (brief)
8. Wire tools to your Agent — `mcp_server_usages` YAML example
9. What's next — links to OAuth guide (T03) and BYOA guide (T04)

### 2. `marketplace-connect-tour` demo

6-step playback: grid browse → select card → detail view → connect →
tools tab → policies tab.

Fixture data drawn from real seedpack entries:
- ~9 `SearchResult` entries for the card grid
- 1 full `McpServer` fixture (PostgreSQL) with post-connect state

### 3. Demo registration

- Export from `site/src/components/docs/index.ts`
- Register in `site/src/components/mdx.tsx`
- Register in `site/src/components/docs/demos/scenarios/registry.ts`

## Source Material

- Seedpack: `seedpack/mcp-servers/` (53 curated YAML entries)
- Seedpack CONTRIBUTING: `seedpack/mcp-servers/CONTRIBUTING.md`
- Grid layout changelog: `_changelog/2026-04/2026-04-13-171427-library-card-grid-layout.md`
- Proto: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`
- Existing demos: `connect-playback`, `mcp-server-creation-tour`
- Document writer role: `_roles/002_document_writer.md`
- Vocabulary guide: `docs/vocabulary.md`

## Verification

- `yarn build` passes in `site/`
- `connect-from-marketplace` renders in the sidebar under Integrations
- Demo plays through all 6 steps with cursor, captions
- No broken cross-links
- Register is consistent: how-to guide tone, proper nouns capitalized

## Full Project Task Map

| Task | Title | Status |
|------|-------|--------|
| **T01** | Concepts expansion + nav setup | COMPLETE |
| **T02** | Marketplace and connect guides + demos | IN PROGRESS |
| **T03** | OAuth for tools guide + hero demo | Not started |
| **T04** | BYOA guide + demo | Not started |
| **T05** | Architecture transparency page | Not started |
| **T06** | Tutorial completion + demo updates | Not started |
| **T07** | SDK reference polish | Not started |
