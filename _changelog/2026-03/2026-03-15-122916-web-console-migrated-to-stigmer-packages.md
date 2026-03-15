# Migrate Web Console to @stigmer/* Library Packages

**Date**: March 15, 2026

## Summary

Migrated the Stigmer web console to consume its own `@stigmer/*` workspace packages instead of local source files. All execution components, hooks, and helpers now import from `@stigmer/react-ui/execution`, the `cn()` utility imports from `@stigmer/theme`, and a new IoC bridge component wires the console's auth system into the library's transport provider. This eliminates ~1,155 lines of duplicated code from the console.

## Problem Statement

After extracting reusable components into `@stigmer/rpc-client`, `@stigmer/theme`, and `@stigmer/react-ui` (T01–T04), the console still contained its original local copies of execution components, hooks, services, and utilities. This meant:

### Pain Points

- Two copies of every execution component — one in the library, one in the console
- Two transport mechanisms — the library's IoC-based `StigmerTransportProvider` and the console's singleton `transport.ts`
- `cn()` utility defined locally in `src/lib/utils.ts` instead of coming from the shared `@stigmer/theme` package
- Any future bug fix or feature in execution components would need to be applied in two places
- New shadcn components generated via CLI would use the stale `@/lib/utils` alias

## Solution

Four-phase migration that replaced all local execution code with library imports, wired the transport provider into the React tree, and cleaned up dead code:

1. **Transport bridge**: Created `StigmerTransportBridge` — a React component that reads auth context and environment config, then provides a configured transport to all library hooks downstream
2. **Execution consumer migration**: Updated 3 pages and 1 hook to import from `@stigmer/react-ui/execution`
3. **cn() migration**: Updated 13 files and the shadcn `components.json` alias to import from `@stigmer/theme`
4. **Dead code removal**: Deleted 12 files (9 execution components, 2 hooks, 1 service)

## Implementation Details

### StigmerTransportBridge (IoC Bridge Pattern)

The bridge component sits between `AuthGuard` and the rest of the app in the provider tree:

```
AuthProvider → AuthGuard → StigmerTransportBridge → OrgProvider → App
```

It extracts `accessToken` from `useAuth()` and `serverUrl` from `getApiBaseUrl()`, wraps them into the shape `StigmerTransportProvider` expects, and renders children. Library hooks like `useExecutionService()` and `useAgentExecution()` can then access a configured transport without any knowledge of the console's auth system.

### Import Migration

All execution-related imports changed from local `@/` paths to library paths:

| Before | After |
|--------|-------|
| `@/components/execution` | `@stigmer/react-ui/execution` |
| `@/hooks/useAgentExecution` | `@stigmer/react-ui/execution` |
| `@/hooks/useApproval` | `@stigmer/react-ui/execution` |
| `@/services/execution-service` | `useExecutionService()` hook |
| `@/lib/utils` (cn) | `@stigmer/theme` |
| `@/lib/execution` (helpers) | `@stigmer/react-ui/execution` |

### useSessionDetail Refactor

The `useSessionDetail` hook previously called `listExecutionsBySession` as a bare function import from the local service. Since the library exposes this via `useExecutionService()`, the hook was refactored to call `executionService.listExecutionsBySession()` through the service object — aligning with the IoC pattern.

### Files Changed

- **31 files** total: 53 insertions, 1,208 deletions
- **Created**: `src/components/providers/StigmerTransportBridge.tsx`
- **Modified**: 18 files (3 pages, 1 hook, 7 shadcn components, 6 app files, `Providers.tsx`, `components.json`)
- **Deleted**: 12 files (9 execution components + barrel, 2 hooks, 1 service)

## Benefits

- **Single source of truth**: Execution components live only in `@stigmer/react-ui` — no duplication
- **Consistent transport**: All execution RPC calls flow through `StigmerTransportProvider` with per-request auth tokens
- **Future-proof shadcn**: `components.json` alias ensures new components use `@stigmer/theme` automatically
- **Reduced console surface**: ~1,155 fewer lines to maintain in the web console
- **Library-first pattern established**: The console is now the first consumer of its own libraries, validating the extraction

## Impact

- **Web console**: All execution UI flows (agent runs, session detail, drafts) now use library components
- **Library packages**: Validated as production-ready — the console exercises every exported component, hook, and helper
- **Developer experience**: New execution features go into `@stigmer/react-ui` and are immediately available to both the console and future external consumers

## Related Work

- T01–T04 (same project): Created `_libs` structure and extracted packages
- T06 (next): npm publishing — build tooling and CI for the extracted packages

---

**Status**: Production Ready
**Timeline**: Single session (~2 hours)
