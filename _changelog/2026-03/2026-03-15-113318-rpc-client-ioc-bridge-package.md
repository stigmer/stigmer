# @stigmer/rpc-client — IoC Bridge for Connect-RPC Transport

**Date**: March 15, 2026

## Summary

Implemented `@stigmer/rpc-client`, the infrastructure-layer package that provides a configurable Connect-RPC transport via the IoC bridge pattern. Replaces the web console's hardcoded singleton transport with a React Context + imperative factory design that external consumers can wire to their own auth and server configuration.

## Problem Statement

The Stigmer web console's gRPC-Web transport is a module-level singleton that reads its configuration from `env.ts` and `token-store.ts` at import time. This couples all service calls to the console's specific auth mechanism and server URL resolution, making it impossible for external consumers to embed Stigmer UI components with their own backend.

### Pain Points

- Singleton transport created at module scope — no way to configure per-consumer
- Auth token stored in mutable module variable (`_token` in `token-store.ts`) — not composable
- Server URL resolved from Next.js environment variables — breaks in non-Next.js hosts
- No separation between "how to make RPC calls" (reusable) and "where is my server / how do I auth" (consumer-specific)
- Interceptors (auth, error stripping) tangled with transport construction

## Solution

Adopted an Inversion of Control (IoC) bridge pattern with two complementary APIs:

1. **Imperative factory** (`createStigmerTransport(config)`) — pure function, no React dependency, usable in tests and scripts
2. **React Context provider** (`StigmerTransportProvider`) — distributes the transport through the component tree, wired by consumer's bridge component

Consumers provide `serverUrl` and optionally `getAccessToken` (async callback). The library never reads env vars or manages auth state directly.

## Implementation Details

Six modules in `_libs/infra/rpc-client/src/`:

- **`types.ts`** — `StigmerRpcConfig` interface: `serverUrl`, `getAccessToken?: TokenProvider`, `interceptors?: Interceptor[]`. `TokenProvider` is `() => Promise<string | null> | string | null` (sync and async consumers both work).

- **`interceptors.ts`** — Two factory interceptors:
  - `createAuthInterceptor(getAccessToken?)`: Calls the token provider per-request, sets `Authorization: Bearer <token>` header. No-op when provider is absent or returns null.
  - `errorStripInterceptor`: Strips gRPC status code prefixes (e.g., `[unknown] actual message` → `actual message`) from error messages for cleaner UI display.

- **`transport.ts`** — `createStigmerTransport(config)`: Pure factory returning a `Transport` via `createGrpcWebTransport`. Composes interceptors in order: auth → error strip → consumer-provided.

- **`context.ts`** — `StigmerTransportContext`: Separate React context file (prevents circular imports between provider and hooks, consistent with the console's existing `auth/context.tsx` pattern).

- **`provider.tsx`** — `StigmerTransportProvider`: Creates transport via `useMemo`, distributes via context. Transport recreates when `serverUrl`, `getAccessToken`, or `interceptors` change. Consumers stabilize callbacks with `useCallback` — standard React memoization contract.

- **`hooks.ts`** — Two hooks:
  - `useStigmerTransport()`: Returns transport from context, throws descriptive error if no provider.
  - `useServiceClient(service)`: Generic typed client factory — `const client = useServiceClient(AgentService)` returns a fully typed `Client<typeof AgentService>`.

- **`index.ts`** — Barrel export with convenience re-exports from `@connectrpc/connect` (`createClient`, `Client`, `Transport`, `Interceptor`) and `@bufbuild/protobuf` (`DescService`).

### React 19 Compatibility Discovery

The original plan called for a ref-based callback pattern to provide a stable `getAccessToken` reference without requiring consumer `useCallback`. React 19's new `react-hooks/refs` ESLint rule forbids reading `ref.current` during render (including inside `useMemo` callbacks), making this pattern a lint violation. The simpler `useMemo` with explicit deps approach was adopted — consumers provide stable callbacks via `useCallback`, which is the standard React practice used by Apollo Client, TanStack Query, and other major library providers.

### `DescService` Import Discovery

`DescService` (the service descriptor type used by `createClient`) is exported from `@bufbuild/protobuf`, not `@connectrpc/connect`. The Connect-RPC docs show `createClient(MyService, transport)` but don't clarify which package exports the descriptor type. Verified by inspecting `node_modules/@connectrpc/connect/dist/types/index.d.ts`.

## Benefits

- **External consumers**: Wire any auth provider (Clerk, Auth0, custom) via a single `getAccessToken` callback
- **Testability**: `createStigmerTransport()` works in Node.js test suites without React
- **Type safety**: `useServiceClient(AgentService)` returns fully typed RPC methods — no manual `createClient` boilerplate per component
- **Clean separation**: Library never touches env vars, module singletons, or global state
- **Incremental migration**: Old singleton transport still works alongside the new provider (coexistence until T05)

## Impact

- **@stigmer/react-ui** (T04): Will use `useServiceClient()` to call RPC services, making execution components fully portable
- **Console bridge** (T05): ~10-line `StigmerClientBridge` component wires `useAuth()` → `StigmerTransportProvider`
- **External platforms**: Can embed Stigmer execution UI by providing their own server URL and auth callback

## Related Work

- Preceding: `2026-03-15-111024-web-libs-workspace-scaffolding` — T01 scaffolding
- Reference: Planton's `@planton/rpc-client` at `plantonhq/planton/client-apps/web/_libs/infra/rpc-client/`
- Next: T03 (@stigmer/theme — CSS tokens + cn utility), T04 (@stigmer/react-ui — execution components)

---

**Status**: Production Ready
**Timeline**: T02 of 6-task project
