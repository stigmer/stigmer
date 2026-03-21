# DD-002: Sub-routes Over Tabs for Resource Types

**Date**: 2026-03-20
**Status**: Decided
**Participants**: Developer + Architect

## Context

The Library page needs navigation between three resource types: Agents, Skills, MCP Servers. Two options: tabs on a single `/library` page, or sub-routes (`/library/agents`, etc.).

## Decision

Use **sub-routes** for each resource type.

## Rationale

- **Jakob's Law**: Developers spend most of their time in tools (GitHub, AWS Console, Vercel) where resource type navigation uses distinct URLs. Tabs within a single URL are a settings-page pattern, not a resource management pattern.
- **Nielsen's Heuristic #3 (User Control and Freedom)**: Sub-routes give browser back/forward, bookmarking, and URL sharing for free.
- **Nielsen's Heuristic #1 (Visibility of System Status)**: The URL is system status. `/library/mcp-servers` clearly communicates what the user is looking at.
- The "less routing complexity" argument for tabs is an engineering convenience concern, not a user experience concern.

## Routes

| Route | Purpose |
|---|---|
| `/library` | Landing page with resource cards |
| `/library/agents` | Agent list |
| `/library/skills` | Skill list |
| `/library/mcp-servers` | MCP Server list |

## Alternatives Considered

- **Tabs on single page**: Simpler routing but loses URL shareability. Tabs are for facets of one entity; Agents/Skills/MCP Servers are different resource types.
