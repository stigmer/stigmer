# Web Phase 4: Three-Layer Service Architecture with TanStack Query

**Date**: March 15, 2026

## Summary

Implemented the three-layer service architecture (service factories, service hooks, TanStack Query hooks) across all four web console domains. This replaces 14 ad-hoc hooks and 5 service modules with a structured, consistent pattern backed by TanStack Query for caching, deduplication, and automatic refetching. Four new domain library packages were created, and the existing `@stigmer/agent-execution-ui` package was structurally flattened for consistency.

## Problem Statement

The web console's data fetching layer had grown organically with each domain implementing its own patterns — raw `useState`/`useEffect` hooks, module-level service singletons, inconsistent error handling, and no caching or deduplication. This created maintenance burden, inconsistent UX (some pages had loading states, others didn't), and made it difficult to add new domains.

### Pain Points

- 9 hooks each implementing their own `useState`/`useEffect` fetch-on-mount pattern
- 5 service modules using a singleton transport instead of context-based IoC
- No request deduplication — navigating back to a page re-fetched data every time
- No stale-while-revalidate — users saw loading spinners on every navigation
- `useResourceCatalog` was a generic "one hook fits all" abstraction that obscured domain boundaries
- `useSessionDetail` fetched both session and executions in one hook, violating single responsibility
- `@stigmer/agent-execution-ui` had a redundant `execution/` subdirectory nesting

## Solution

Applied the three-layer service architecture defined in design decision 003-hook-pattern-contract:

- **Layer 1 (Service Factories)**: Pure TypeScript, no React. `createXxxQueryService(transport)` returns a typed service interface.
- **Layer 2 (Service Hooks)**: Minimal React. `useXxxQueryService()` binds the factory to the transport from `StigmerTransportProvider` context.
- **Layer 3 (Query Hooks)**: Console-only. TanStack Query hooks (`useQuery`, `useInfiniteQuery`) with hierarchical query key factories.

## Implementation Details

### Foundation

- Installed `@tanstack/react-query` and added `QueryClientProvider` to the provider tree with defaults: `staleTime: 30s`, `retry: 1`, `refetchOnWindowFocus: true`
- Created `useDebouncedValue` utility hook for search inputs

### Domain Libraries Created (Layer 1 + Layer 2)

| Package | Service Factory | Methods |
|---------|----------------|---------|
| `@stigmer/agent-ui` | `AgentQueryService` | `get`, `getByReference`, `search` |
| `@stigmer/session-ui` | `SessionQueryService` | `get`, `list`, `listByAgent` |
| `@stigmer/skill-ui` | `SkillQueryService` | `get`, `search` |
| `@stigmer/mcp-server-ui` | `McpServerQueryService` | `get`, `search` |

### Console Query Hooks Created (Layer 3)

| Hook | Pattern | Replaces |
|------|---------|----------|
| `useAgent(id)` | `useQuery` | `useAgentDetail` |
| `useAgentList(org, search, page)` | `useQuery` | `useResourceCatalog(agent)` |
| `useAgentSearch(query)` | `useQuery` + debounce | `useAgentSearch` |
| `useDraftAgent(slug)` | `useQuery` | `useDraftAgent` |
| `useSession(id)` | `useQuery` | `useSessionDetail` (part) |
| `useSessionExecutions(sessionId)` | `useQuery` | `useSessionDetail` (part) |
| `useSessionList(org)` | `useInfiniteQuery` | `useSessions` |
| `useAgentSessionList(agentId)` | `useInfiniteQuery` | `useAgentSessions` |
| `useSkill(id)` | `useQuery` | `useSkillDetail` |
| `useSkillList(org, search, page)` | `useQuery` | `useResourceCatalog(skill)` |
| `useMcpServer(id)` | `useQuery` | `useMcpServerDetail` |
| `useMcpServerList(org, search, page)` | `useQuery` | `useResourceCatalog(mcp-server)` |

### Structural Cleanup

- Flattened `@stigmer/agent-execution-ui` — removed redundant `execution/` subdirectory and `internal/ui/` nesting
- Removed `./execution` subpath export — consumers now import from `@stigmer/agent-execution-ui` directly
- Deprecated `transport.ts` (singleton) and `org-service.ts` (legacy transport) with JSDoc comments

### Deleted (14 files)

- 9 old hooks: `useAgentDetail`, `useAgentSearch`, `useDraftAgent`, `useResourceCatalog`, `useSessionDetail`, `useSessions`, `useAgentSessions`, `useSkillDetail`, `useMcpServerDetail`
- 5 old services: `agent-service`, `search-service`, `session-service`, `skill-service`, `mcp-server-service`

## Benefits

- **Automatic caching**: TanStack Query caches responses for 30s — navigating back to a page shows cached data instantly
- **Request deduplication**: Multiple components requesting the same data share a single network request
- **Background refetching**: Data refreshes in the background when the window regains focus
- **Consistent error handling**: Every hook surfaces `error.message` — components decide how to display
- **Domain isolation**: Each domain has its own package with typed service contracts
- **Embeddable services**: Layer 1 factories work in any TypeScript context, not just the console
- **Predictable cache invalidation**: Hierarchical query key factories enable precise invalidation when command hooks are added

## Impact

- 11 consumer components updated with cleaner, more consistent data-fetching patterns
- Net reduction of ~734 lines of code (1,124 deleted, 390 added)
- All 4 domain library packages type-check independently
- Build, ESLint, and format checks pass clean

## Related Work

- Design decision: `003-hook-pattern-contract.md`
- Coding guideline: `query-command-hooks.md`
- Previous: [Web Phase 1-3](2026-03-15-150158-web-phase1-dead-code-tooling.md) — dead code, tooling, visual identity, navigation IA

---

**Status**: Production Ready
**Timeline**: Phase 4 (T06 design + T07+T08 implementation)
