# SDK Single-Resource Data Hooks for Library Detail Views

**Date**: March 20, 2026

## Summary

Added three single-resource data hooks to `@stigmer/react` — `useAgent`, `useSkill`, and `useMcpServer` — providing the data layer foundation for upcoming Library detail view pages. Each hook wraps the corresponding `getByReference()` SDK client method with loading, error, and not-found state management, following the established `useDefaultAgent`/`useAgentInstance` pattern.

## Problem Statement

The Library list pages exist for Agents, Skills, and MCP Servers, but clicking an item has nowhere to go — there are no detail view pages, and no data hooks to fetch a single resource by org + slug. The TypeScript SDK already has typed `getByReference()` methods for all three resource types, but no React hooks wrap them for use in components.

### Pain Points

- Platform builders wanting to display a single agent/skill/MCP server must manually manage `useEffect`, cancellation, error handling, and loading state
- No consistent pattern for handling NOT_FOUND (404) as a valid state rather than an error
- Detail view components (Phase 2) need a data layer to build on

## Solution

Three new hooks in `@stigmer/react`, each following the proven single-resource hook pattern:

- `useAgent(org, slug)` → `{ agent, isLoading, error, refetch }`
- `useSkill(org, slug, version?)` → `{ skill, isLoading, error, refetch }`
- `useMcpServer(org, slug)` → `{ mcpServer, isLoading, error, refetch }`

## Implementation Details

**Pattern**: `useState` + `useEffect` with cancellation ref, `fetchKey` counter for `refetch()`, `null` org/slug to skip fetching.

**404 handling**: Each hook uses `isNotFound()` from `@stigmer/sdk` to map NOT_FOUND errors to `null` resource without raising an error. This makes the consumer's state machine clean — "not found" is distinguished from "loading" and "error" without an extra boolean.

**Files created**:
- `sdk/react/src/agent/useAgent.ts`
- `sdk/react/src/skill/useSkill.ts`
- `sdk/react/src/mcp-server/useMcpServer.ts`

**Files modified** (barrel exports):
- `sdk/react/src/agent/index.ts`
- `sdk/react/src/skill/index.ts`
- `sdk/react/src/mcp-server/index.ts`
- `sdk/react/src/index.ts`

## Benefits

- Platform builders can fetch a single resource with one line: `const { agent } = useAgent("acme", "my-agent")`
- Consistent error handling and loading state management across all resource types
- NOT_FOUND handling baked in — no need for consumers to catch and classify errors
- Foundation for Phase 2 detail view components (`AgentDetailView`, `SkillDetailView`, `McpServerDetailView`)

## Impact

- **`@stigmer/react`**: 3 new hooks + 3 new return types added to public API
- **Platform builders**: Can now fetch and display individual Agent, Skill, and MCP Server resources
- **Console**: Unblocks Library detail view pages (Phase 2–3 of the resource-detail-views sub-project)

## Related Work

- Part of sub-project `20260320.03.sp.resource-detail-views` (Phase 5 of `20260320.01.library-and-artifacts-flow`)
- Builds on existing list hooks: `useAgentList`, `useSkillList`, `useMcpServerList`
- Next: Phase 2 — SDK detail view components (`AgentDetailView`, `SkillDetailView`, `McpServerDetailView`)

---

**Status**: ✅ Production Ready
