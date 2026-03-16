# @stigmer/react Consolidation — Phase 2 of SDK Package Restructure

**Date**: March 16, 2026

## Summary

Consolidated five domain-specific React packages (`@stigmer/agent`, `@stigmer/session`, `@stigmer/mcp-server`, `@stigmer/skill`, `@stigmer/agent-execution`) and the `@stigmer/rpc-client` infrastructure package into a single `@stigmer/react` package backed by the new `@stigmer/sdk` as its data layer. The web console was fully migrated to the new architecture with zero TypeScript errors.

## Problem Statement

The React layer for the Stigmer platform was fragmented across seven npm packages: five domain packages in `client-apps/web/_libs/domain/`, an infrastructure package (`@stigmer/rpc-client`) in `client-apps/web/_libs/infra/`, and a theme package. Each domain package duplicated internal components (Badge, Collapsible, Button), maintained its own service factory hooks, and managed direct Connect-RPC transport concerns — resulting in inconsistent patterns, duplicated code, and a complex dependency graph that made the platform difficult to extend and publish.

### Pain Points

- Five domain packages each re-implemented Badge and Collapsible components with slightly different APIs
- Every hook created its own RPC service client via factory functions (`useAgentQueryService`, `useSessionQueryService`, etc.) rather than sharing a single SDK client
- `@stigmer/rpc-client` mixed framework-agnostic concerns (transport, interceptors, error utilities) with React-specific code (context, provider)
- Error classification, user messaging, and retryability logic was locked inside `@stigmer/rpc-client`, inaccessible to non-React consumers
- Domain packages could not be published independently because they lived inside `client-apps/web/_libs/`
- CSS was duplicated across `agent/styles.css` and `agent-execution/styles.css` with identical `@theme inline` blocks

## Solution

Created `@stigmer/react` at `sdk/react/` as a single, publishable package with subpath exports (`@stigmer/react/agent`, `@stigmer/react/session`, `@stigmer/react/agent-execution`). All React hooks were rewritten to use the `useStigmer()` context hook, which provides the `Stigmer` SDK client instance. Framework-agnostic error utilities were moved into `@stigmer/sdk`. The web console was updated end-to-end.

## Implementation Details

### SDK Error Utilities

Moved from `@stigmer/rpc-client` to `@stigmer/sdk`:
- `classifyError`, `ErrorCategory` — categorize errors as network, auth, validation, server, or unknown
- `getUserMessage` — extract user-friendly error messages
- `isRetryableError`, `isConnectError` — error type predicates
- `RpcErrorMetadata`, `annotateRpcError`, `getRpcMetadata` — RPC call metadata annotation on errors
- Added `rpcMetadataInterceptor` to the SDK's interceptor chain

### @stigmer/react Architecture

- **`StigmerProvider`** — React component accepting a `Stigmer` SDK client instance, distributes via context
- **`useStigmer()`** — Hook to consume the SDK client from any descendant component
- **Subpath exports** — `@stigmer/react/agent`, `@stigmer/react/session`, `@stigmer/react/agent-execution`
- **Internal components** — `Badge`, `Collapsible`, `Button`, `Textarea`, `Section` deduplicated into `src/internal/`
- **Peer dependencies** — `react`, `react-dom`, `@stigmer/sdk`, `@stigmer/protos` to prevent duplicate runtimes

### Hook Rewrites

All domain hooks were rewritten from:
```typescript
const service = useAgentQueryService();
const result = await service.search(query);
```

To:
```typescript
const stigmer = useStigmer();
const result = await stigmer.agent.list(query);
```

Hooks migrated: `useAgentSearch`, `useAgentSessionList`, `useAgentExecution`, `useApproval`

### Web Console Migration (21 files)

- `StigmerTransportBridge` — replaced `StigmerTransportProvider` with `StigmerProvider` wrapping a memoized `Stigmer` client instance
- `OrgProvider` — simplified from manual `createClient` + `OrganizationQueryController` to `stigmer.organization.findMyOrganizations()`
- 14 TanStack Query hooks — migrated from domain service factories to `useStigmer()` direct calls
- Error utility imports — moved from `@stigmer/rpc-client` to `@stigmer/sdk`
- Component imports — moved from domain packages to `@stigmer/react/*` subpath exports

### Monorepo Configuration

- Root `package.json` — removed `_libs/infra/*` and `_libs/domain/*` from workspaces
- `next.config.ts` — `transpilePackages` simplified to `@stigmer/sdk`, `@stigmer/react`, `@stigmer/theme`
- `publish-libs.mjs` — updated to publish `apis/stubs/ts`, `sdk/typescript`, `sdk/react`, theme
- `tsconfig.json` — excluded old `_libs/domain` and `_libs/infra` from compilation scope

## Benefits

- **Single import surface**: Consumers install `@stigmer/react` instead of managing five domain packages
- **SDK-backed data layer**: All API calls go through `@stigmer/sdk`, ensuring consistent error handling, auth, and transport
- **Zero component duplication**: Internal components are shared across all domains
- **Publishable**: Package lives in `sdk/react/` alongside `sdk/typescript/`, ready for npm publishing
- **Simplified mental model**: `useStigmer()` is the single entry point for all data access in React

## Impact

- **Platform builders**: Can now install `@stigmer/sdk` + `@stigmer/react` and embed agent execution, session history, and agent management UIs with minimal setup
- **Web console**: Fully operational on the new architecture; all 21 migrated files compile cleanly
- **Release pipeline**: `publish-libs.mjs` ready for the new 4-package structure (protos, sdk, react, theme)
- **Future development**: New domain features add to `@stigmer/react` subpath exports without creating new packages

## Related Work

- [TypeScript SDK Codegen](2026-03-16-123359-typescript-sdk-codegen-all-resources.md) — Phase 1 Track A: created `@stigmer/sdk` with codegen-driven clients for all 17 API resources
- [Go SDK Restructure](2026-03-16-112653-go-sdk-stripe-style-restructure.md) — Phase 1 Track B: Stripe-style Go SDK
- [Web Libs Workspace Scaffolding](2026-03-15-111024-web-libs-workspace-scaffolding.md) — Original domain package creation
- [RPC Client Bridge](2026-03-15-113318-rpc-client-ioc-bridge-package.md) — Now retired in favor of `@stigmer/sdk` + `@stigmer/react`

---

**Status**: Production Ready
**Timeline**: Single session (with power-loss recovery)
