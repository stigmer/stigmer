# Add `useSkillList` and `useMcpServerList` Data Hooks

**Date**: March 20, 2026

## Summary

Added `useSkillList` and `useMcpServerList` data hooks to `@stigmer/react`, completing the set of three resource list hooks needed for the Library pages. Both follow the established pattern from `useAgentList`: thin wrappers over the shared internal `useResourceList` hook with domain-specific entry field naming.

## Problem Statement

The Library feature requires paginated, scope-aware list views for all three browsable resource types: Agents, Skills, and MCP Servers. T01.1 delivered `useAgentList` and the shared `useResourceList` foundation. Skills and MCP Servers still lacked their public list hooks, blocking the Library list pages (T01.11–T01.13).

### Pain Points

- Platform builders needing paginated skill or MCP server browsing had no dedicated hook — only the picker/type-ahead search hooks (`useSkillSearch`, `useMcpServerSearch`) which manage their own debounced state and are limited to page 1.
- The Library list pages cannot be built without externally-controlled list hooks that expose pagination, scope, and query parameters to the consumer.

## Solution

Created two thin wrapper hooks that delegate to `useResourceList`, following the identical pattern established by `useAgentList`. Each hook wraps the corresponding SDK client method and remaps the generic `entries` field to a domain-specific name.

## Implementation Details

### New files

| File | Hook | Entry field | SDK client method |
|------|------|-------------|-------------------|
| `sdk/react/src/skill/useSkillList.ts` | `useSkillList` | `skills` | `stigmer.skill.list` |
| `sdk/react/src/mcp-server/useMcpServerList.ts` | `useMcpServerList` | `mcpServers` | `stigmer.mcpServer.list` |

### Hook API (identical shape for both)

- **Signature**: `use{Resource}List(org: string | null, options?: Use{Resource}ListOptions)`
- **Options**: `pageSize`, `page`, `query`, `scope` (`"org"` | `"all"`)
- **Returns**: `{ {entries}, totalCount, totalPages, currentPage, isLoading, error, refetch }`
- **Null-org skip**: Passing `null` as `org` produces a stable no-op (no fetch, empty state)

### Barrel export updates

- `sdk/react/src/skill/index.ts` — added `useSkillList`, `UseSkillListOptions`, `UseSkillListReturn`
- `sdk/react/src/mcp-server/index.ts` — added `useMcpServerList`, `UseMcpServerListOptions`, `UseMcpServerListReturn`
- `sdk/react/src/index.ts` — added both hooks and types to the top-level public API

## Benefits

- Platform builders can now browse skills and MCP servers with the same paginated, scope-aware API used for agents — consistent DX across all three resource types.
- All three list hooks are one import away: `import { useAgentList, useSkillList, useMcpServerList } from "@stigmer/react"`.
- The Library list pages (T01.11–T01.13) are now unblocked.

## Impact

- **`@stigmer/react` public API**: 2 new hooks, 4 new types exported — additive, no breaking changes.
- **Library project**: Completes the data hook layer for Phase 1. Next work shifts to UI components (T01.4–T01.8).

## Related Work

- [use-agent-list-and-resource-list-hooks](2026-03-20-105950-use-agent-list-and-resource-list-hooks.md) — T01.1 that created the `useResourceList` foundation and `useAgentList`
- Library & Artifacts Flow project: `_projects/2026-03/20260320.01.library-and-artifacts-flow/`

---

**Status**: ✅ Production Ready
