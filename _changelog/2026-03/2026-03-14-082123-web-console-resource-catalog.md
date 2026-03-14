# Web Console: Resource Catalog (Agents, Skills, MCP Servers)

**Date**: March 14, 2026

## Summary

Built the complete resource catalog for the Stigmer Web Console MVP — list/search pages with card-based UI and detail pages with structured, domain-specific rendering for all three core resource types: Agents, Skills, and MCP Servers. This is T05 of the web console MVP, adding 17 new files and modifying 4 existing files with zero build errors.

## Problem Statement

The web console had stub pages for `/agents`, `/skills`, and `/mcp-servers` with no actual functionality. Users had no way to browse, search, or inspect the platform's resource catalog through the browser — forcing all discovery to happen via the CLI.

### Pain Points

- No browser-based way to discover available agents, skills, or MCP servers
- No search/filter across the resource catalog
- No detail views to understand what an agent does, what tools an MCP server provides, or what a skill's content looks like
- Three PageStub placeholders where functional pages should be

## Solution

A three-layer architecture following the existing codebase patterns:

1. **Service layer**: Generic `searchResources(kind)` for catalog discovery via SearchService RPC + per-resource `get(id)` services for detail fetching
2. **Hook layer**: `useResourceCatalog(kind)` generic hook with debounced search and pagination + `useAgentDetail`, `useSkillDetail`, `useMcpServerDetail` for full-resource fetching
3. **UI layer**: Shared catalog components (ResourceCard, ResourceList, CatalogEmptyState) + domain-specific detail views (AgentDetailView, SkillDetailView, McpServerDetailView)

## Implementation Details

### Architectural Discovery: No List RPCs

Individual query controllers (AgentQueryController, SkillQueryController, McpServerQueryController) only expose `get` and `getByReference` — no list or search RPCs exist. SearchService is the sole discovery mechanism. This is architecturally sound (search as cross-cutting concern) and meant the catalog pages depend entirely on the SearchResult projection for list views, with per-resource `get(id)` RPCs providing full detail.

### Service Layer

- Extended `search-service.ts` with a generic `searchResources(kind, options)` function accepting any `ApiResourceKind`, plus `searchSkills()` and `searchMcpServers()` thin wrappers
- Created `agent-service.ts`, `skill-service.ts`, `mcp-server-service.ts` — each wrapping their respective QueryController's `get(id)` RPC
- Note: McpServerQueryController uses `ApiResourceIdSchema` from commons (not `McpServerIdSchema`), unlike Agent/Skill which use domain-specific ID schemas

### Generic Catalog Hook

`useResourceCatalog(kind)` provides debounced search (300ms), pagination, and stale-response protection via `requestIdRef`. A single hook parameterized by `ApiResourceKind` eliminates duplication across the three catalog pages.

### Card-Based Catalog UI

Chose cards over the originally-planned data table because catalog data is qualitative (name, description, tags) not quantitative. `ResourceCard` displays kind icon, name, qualified slug, description (2-line clamp), visibility badge, tags (capped at 5), and relative timestamp — matching the existing `SessionCard` pattern.

### Structured Detail Views

Domain-specific rendering instead of generic YAML:
- **AgentDetailView**: Collapsible instructions, MCP server usages with enabled tools, skill refs, sub-agents with model overrides, "Run this agent" CTA
- **SkillDetailView**: Rendered SKILL.md via ReactMarkdown + remarkGfm (reusing OutputBlock's prose classes), git provenance, version hash, state badge
- **McpServerDetailView**: Server config (stdio command/args or HTTP URL), discovered tools with collapsible JSON input schemas, default tool approval policies, resource templates, validation state badge

## Benefits

- Users can now browse, search, and inspect all platform resources from the browser
- Card-based catalog provides information density with progressive disclosure
- Domain-specific detail views surface what matters for each resource type
- Generic hook/component architecture makes adding new resource types straightforward
- Zero code duplication between the three catalog pages

## Impact

- **End users**: Can discover and understand agents, skills, and MCP servers without CLI
- **Platform**: 6 new routes (3 list + 3 detail) fully functional
- **Codebase**: Established reusable patterns (searchResources, useResourceCatalog, ResourceCard/ResourceList) for any future searchable resource type
- **Build health**: `yarn build` passes with zero errors

## Related Work

- **T03 (Run Page)**: Agent search established the SearchService client pattern; T05 generalized it
- **T04 (Sessions)**: SessionCard pattern directly informed ResourceCard design
- **T02 (Execution Engine)**: OutputBlock's ReactMarkdown + remarkGfm setup reused in SkillDetailView

---

**Status**: ✅ Production Ready
**Timeline**: Session 6 (2026-03-14)
