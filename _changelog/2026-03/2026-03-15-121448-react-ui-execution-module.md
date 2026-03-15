# Extract Execution Components into @stigmer/react-ui

**Date**: March 15, 2026

## Summary

Extracted all execution streaming components, services, and hooks from the Stigmer web console into the `@stigmer/react-ui` workspace package. The library is now a complete, self-contained execution module with IoC-based transport injection via `@stigmer/rpc-client`. The console stays green via proxy re-exports.

## Problem Statement

Stigmer's execution streaming UI (real-time agent execution monitoring, tool call rendering, HITL approval controls) was embedded inside the web console as local source files. Platform owners who want to embed agent execution UI in their own apps had no reusable package to install.

### Pain Points

- Execution components only available as console-internal code
- No way for external consumers to render agent executions
- Services used a module-level singleton transport, impossible to inject or test
- Tight coupling to console's `@/` import aliases and auth infrastructure

## Solution

Moved all execution-related code into `@stigmer/react-ui` as a domain-layer workspace package, following the three-layer `_libs` pattern established in T01-T03. Refactored the service layer from module-level singletons to a transport-injectable factory pattern.

## Implementation Details

### Components (8 files moved)

All execution components (`ExecutionStream`, `ExecutionStatus`, `MessageEntry`, `MessageInput`, `OutputBlock`, `ToolCallCard`, `SubAgentCard`, `ApprovalControls`) moved to `_libs/domain/react-ui/src/execution/components/`. Import paths rewired from `@/` aliases to library-internal relative paths and `@stigmer/theme`.

### Service Factory Pattern

Replaced the singleton transport pattern with `createExecutionService(transport: Transport)` — a pure factory that accepts a Connect-RPC transport and returns a typed service object. Paired with `useExecutionService()` hook that reads transport from `StigmerTransportProvider` context.

### Vendored shadcn Components

Four shadcn components (`Badge`, `Button`, `Collapsible`, `Textarea`) copied into `src/internal/ui/` as internal implementation details. Imports changed from `@/lib/utils` to `@stigmer/theme`. This keeps the library self-contained without requiring consumers to provide their own shadcn setup.

### Execution Helpers

All phase, status, message type, and duration utility functions moved to `helpers.ts`. Pure functions with no React or framework dependency.

### Library Hooks

New `useAgentExecution` and `useApproval` hooks that use `useExecutionService` instead of directly importing singleton services. These are the library versions — the console's old hooks remain untouched until T05.

### Proxy Re-exports

Console's `src/components/execution/index.ts` replaced with a proxy that re-exports from `@stigmer/react-ui/execution`. Console pages continue to work with zero changes.

### Architecture Decision: Props over Context

The T01 plan proposed a `StigmerExecutionContext` for callbacks. After analyzing the actual code, the components already use a clean props pattern with only 2-3 levels of depth. The context was dropped as overengineering. The convenience component pattern (hooks + props) is cleaner and more testable.

## Benefits

- **Reusable package**: `@stigmer/react-ui` is now a complete execution module importable by any React app
- **Testable services**: `createExecutionService(transport)` is a pure factory, testable without React or gRPC infrastructure
- **IoC bridge pattern**: Services consume transport from context, not module-level singletons
- **Zero console breakage**: Proxy re-exports preserve all existing import paths
- **Self-contained**: Vendored shadcn components eliminate external UI dependency

## Impact

- `@stigmer/react-ui` goes from empty scaffold to a fully populated domain package
- 20 new files in the library, 1 modified file in the console (proxy barrel)
- `npm run build`: 18 static pages, zero errors
- `npm run lint`: zero errors, zero warnings
- Foundation for T05 (console migration) and T06 (npm publishing)

## Related Work

- T01: Set up `_libs` directory structure and workspace config
- T02: Create `@stigmer/rpc-client` (infra layer)
- T03: Create `@stigmer/theme` (UI layer)
- T05 (next): Migrate Stigmer web console to consume `@stigmer/*` packages
- T06 (future): Set up npm publishing

---

**Status**: Production Ready
**Timeline**: 1 session (~45 minutes)
