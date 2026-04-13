# Tutorial Refresh, Cross-Link Bridge, and Demo Audit (T06)

**Date**: April 13, 2026

## Summary

Refreshed the getting-started tutorial sequence to acknowledge the new MCP integration guides built in T01-T05, established bidirectional cross-links between tutorials and how-to guides, and audited getting-started demos for visual consistency with post-integration-work UI state. Rescoped from the original "build 2 tutorial pages" plan after Diataxis analysis showed the getting-started sequence is already complete.

## Problem Statement

T01-T05 built a rich `guides/integrations/` section with four how-to guides and an architecture explanation page, each with live demos. But the getting-started tutorials — the primary entry point for new users — had no awareness of this content. Readers who completed the tutorial path would not discover the marketplace, OAuth, or BYOA guides unless they manually browsed the sidebar.

### Pain Points

- `connect-tools.mdx` teaches "create from scratch" with no mention that a curated marketplace exists
- `create-agent.mdx` "What's next" links only to Concepts and SDK Reference — not to the integration guides
- `integrations/overview.mdx` has no backlink for newcomers who haven't completed the tutorial
- `mcp-server-creation-tour` and `agent-creation-tour` demos show library list views without card grid layout, inconsistent with the production UI shipped earlier today

## Solution

Three focused workstreams instead of new tutorial pages:

1. **Tutorial refresh** — Added marketplace awareness and integration guide links to `connect-tools.mdx`
2. **Cross-link bridge** — Established bidirectional navigation between tutorials and guides
3. **Demo audit** — Updated stale `layout` props to match production card grid

## Implementation Details

### Workstream 1: connect-tools.mdx refresh

- Added a `<Callout>` after "The problem" section, acknowledging the curated marketplace and linking to the marketplace how-to guide, while clarifying that the tutorial walks through creating from scratch for pedagogical reasons
- Added "Going deeper" `<Cards>` section at the end with links to: Connect from the marketplace, OAuth for tools, and Tools concept page

### Workstream 2: Cross-link bridge

- Added "Tool Integrations" card to `create-agent.mdx` "What's next" — positioned first, before Core Concepts and SDK Reference
- Added tutorial backlink sentence to `integrations/overview.mdx` prerequisites section, completing the bidirectional bridge

### Workstream 3: Demo audit

- Added `layout="grid"` to 3 `ResourceListPage` calls in `mcp-server-creation-tour/index.tsx` (MCP Servers use card grid in production)
- Added `layout="grid"` to 3 `ResourceListPage` calls in `agent-creation-tour/index.tsx` (Agents also use card grid)
- Verified `connect-tools-tour`, `connect-playback` proto fixtures match current shapes — no changes needed
- Confirmed `skill-creation-tour` correctly stays as list layout (skills have no `icon_url`)

## Benefits

- Readers who complete the getting-started tutorials now discover the integration guides naturally
- The marketplace alternative is visible without derailing the tutorial's teaching flow
- All getting-started demos now match the production card grid UI
- Bidirectional cross-links reduce dead-end navigation

## Impact

- **Getting-started tutorials**: Readers see marketplace awareness and deeper integration paths
- **Integration guides**: Newcomers see a backlink to the tutorial for hands-on introduction
- **Demo visual consistency**: MCP server and agent library demos match production layout

## Related Work

- T01-T05 (this project): Built the integration guides that T06 bridges to
- Library card grid layout changelog (`2026-04-13-171427`): Production UI change that the demo audit catches up with

---

**Status**: ✅ Production Ready
**Files Changed**: 5 (3 MDX content, 2 demo components)
