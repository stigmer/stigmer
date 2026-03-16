# SDK Resource Catalog Components

**Date**: March 16, 2026

## Summary

Extracted marketplace card components and search hooks from the web console into the React SDK (`@stigmer/react`) as embeddable, framework-agnostic building blocks. Unified the visual treatment so agents, skills, and MCP servers all render as grid cards in the catalog, and external platform builders can now embed resource browsing in their own applications.

## Problem Statement

The web console had three separate card components for displaying agents, skills, and MCP servers in marketplace/catalog views. These components were tightly coupled to Next.js and web-console-specific UI primitives, making them unusable by external platform builders embedding Stigmer into their products.

### Pain Points

- Skills and MCP Servers rendered as horizontal list rows while Agents had a richer card grid -- inconsistent visual treatment
- Three nearly-identical card components (`AgentSearchCard`, `SkillSearchCard`, `McpServerSearchCard`) operating on the same `SearchResult` type -- unnecessary duplication
- Card components lived in the web console with Next.js `Link` and `@/components/ui/badge` dependencies -- not embeddable
- No SDK hooks for searching skills or MCP servers -- platform builders had no way to build skill/MCP server browsers

## Solution

Created a single `ResourceSearchCard` component in a new `catalog/` module within the React SDK that renders any `SearchResult` as a grid card, auto-detecting the icon from `result.kind`. Added search hooks for skills and MCP servers following the established `useAgentSearch` pattern.

## Implementation Details

### New SDK modules

- **`@stigmer/react/catalog`** -- `ResourceSearchCard` component with kind-based icon mapping (Bot for agents, FileCode2 for skills, Server for MCP servers), `href`/`onClick` interactivity following the `AgentCard` pattern, and an `icon` prop for overrides. Includes an internal `time.ts` utility for relative timestamp formatting (`formatRelativeTime`, `toDate`).
- **`@stigmer/react/skill`** -- `useSkillSearch` hook with debounced search returning full `SearchResult[]` objects.
- **`@stigmer/react/mcp-server`** -- `useMcpServerSearch` hook with the same pattern.

### Web console integration

- All three marketplace pages now import `ResourceSearchCard` from `@stigmer/react/catalog`
- Skills and MCP Servers pages switched from `layout="list"` to `layout="grid"`
- Three web-console-specific card components removed (`AgentSearchCard`, `SkillSearchCard`, `McpServerSearchCard`)

### Design decisions

- Single `ResourceSearchCard` instead of three components: all three resource types share the identical `SearchResult` data shape, so three components would violate DRY
- New search hooks return `SearchResult[]` directly (not a simplified type) for immediate compatibility with `ResourceSearchCard`
- Existing `useAgentSearch` left unchanged for backward compatibility (it serves `AgentPicker`)

## Benefits

- Platform builders can now embed resource catalog cards in their applications with `@stigmer/react/catalog`
- Consistent card grid layout across all three resource types in the marketplace
- Single source of truth for catalog card rendering -- no more drift between three card implementations
- Three new subpath exports (`./catalog`, `./skill`, `./mcp-server`) extend the SDK's public surface

## Impact

- **React SDK**: Three new modules added with clean barrel exports and package.json subpath entries
- **Web console**: Three pages updated, three files deleted, barrel export cleaned up
- **Platform builders**: New embeddable components and hooks for building resource browsers

## Related Work

- Existing `AgentCard` component in `@stigmer/react/agent` remains for detail views (takes full `Agent` protobuf)
- Future: `SkillCard`, `McpServerCard` detail components, `ResourceCatalog` composite, `SkillPicker`/`McpServerPicker`

---

**Status**: Production Ready
