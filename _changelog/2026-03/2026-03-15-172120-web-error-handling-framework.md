# Web Error Handling Framework

**Date**: March 15, 2026

## Summary

Implemented a complete three-tier error handling framework for Stigmer Web — from transport-level ConnectError classification through TanStack Query smart retry to component-level display via sonner toasts and inline error messages. Every gRPC error now follows a classified path from transport interceptor to user-facing display, replacing ad-hoc `error.message` rendering with structured, category-aware error handling.

## Problem Statement

The web console had no systematic error handling strategy. Every page that caught an error rendered the raw `error.message` string in a hand-rolled `<div>`. There was no error classification (auth vs permission vs server vs validation), no smart retry logic (all errors retried equally), no user-friendly message sanitization (infrastructure noise like "no healthy upstream" reached the user), and no toast infrastructure for mutation feedback.

### Pain Points

- Raw error messages with infrastructure noise displayed to users
- No distinction between retryable (server/unavailable) and non-retryable (auth/validation) errors
- No auth redirect — expired tokens produced cryptic error messages instead of redirecting to login
- No toast notifications for mutation success/failure feedback
- Copy-paste error display markup across every detail page
- No RPC metadata on errors — generic "something went wrong" with no debugging context

## Solution

A three-tier architecture that maps gRPC status codes to error categories, handles cross-cutting concerns at the transport layer, leverages TanStack Query for intelligent retry, and provides reusable display components.

**Tier 1: Transport Interceptors (`@stigmer/rpc-client`)**
Pure TypeScript, no React. Error classification, RPC metadata annotation, auth redirect, message sanitization.

**Tier 2: TanStack Query Configuration (console)**
Smart retry via `isRetryableError()` — only transient errors retry. Mutations never retry.

**Tier 3: Component Display (console)**
`<ErrorMessage>` for inline query errors. Sonner toast for mutation feedback. Improved root error boundary.

## Implementation Details

### Error Classification (`errors.ts`)

Maps all 16 gRPC status codes to 8 semantic categories:

| Category | Codes | Retryable | UX |
|----------|-------|-----------|-----|
| `auth` | UNAUTHENTICATED | No | Redirect to login |
| `permission` | PERMISSION_DENIED | No | Inline error |
| `not-found` | NOT_FOUND | No | Inline error |
| `validation` | INVALID_ARGUMENT, FAILED_PRECONDITION, OUT_OF_RANGE, ABORTED, ALREADY_EXISTS | No | Inline/form error |
| `server` | INTERNAL, UNKNOWN, DATA_LOSS, UNIMPLEMENTED | Yes | Inline + retry |
| `unavailable` | UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED | Yes | Inline + retry |
| `cancelled` | CANCELLED | No | Silent |
| `unknown` | Non-ConnectError | No | Inline error |

Key utilities: `classifyError()`, `getUserMessage()` (sanitizes infra noise), `isRetryableError()`, `isConnectError()`, `annotateRpcError()`/`getRpcMetadata()` (WeakMap-backed RPC metadata).

### Transport Interceptors

- `rpcMetadataInterceptor` — annotates errors with method name and path for downstream display
- `createAuthRedirectInterceptor(onUnauthenticated)` — calls callback once on UNAUTHENTICATED, dedup-guarded

Chain order: auth token → metadata → error strip → auth redirect → custom.

### Console Integration

- `sonner` installed for toast notifications
- Themed `<Toaster>` syncs with next-themes and uses shadcn design tokens
- `QueryClient` retry: `isRetryableError()` gates query retries, mutations never retry
- `StigmerTransportBridge` wires `onUnauthenticated` via `useAuth().logout()`

### Display Components

- `<ErrorMessage>` — classified inline error with expandable RPC metadata and conditional retry button
- Root error boundary (`app/error.tsx`) — category-specific titles and error digest display
- 2 representative pages updated: `AgentDetailPage`, `SkillDetailPage`

## Benefits

- **User-facing messages are clean** — infrastructure noise sanitized before display
- **Smart retry** — auth/permission/validation errors fail immediately, only transient errors retry
- **Auto-redirect on auth expiry** — UNAUTHENTICATED triggers logout, no cryptic error messages
- **Consistent error display** — `<ErrorMessage>` replaces copy-paste error markup
- **Debugging context** — RPC metadata (method, path) available in expandable details
- **Mutation feedback** — toast notifications for success/error via sonner
- **Domain purity preserved** — all classification utilities are pure TypeScript in `@stigmer/rpc-client`, no React dependency

## Impact

- `@stigmer/rpc-client`: 5 files modified/created (errors.ts, interceptors.ts, types.ts, transport.ts, index.ts)
- Console: 8 files modified/created (Providers.tsx, StigmerTransportBridge.tsx, sonner.tsx, error-message.tsx, error.tsx, AgentDetailPage.tsx, SkillDetailPage.tsx, package.json)
- Coding guideline updated: `query-command-hooks.md` Error Handling section expanded with full three-tier documentation
- All remaining detail pages can adopt `<ErrorMessage>` incrementally

## Related Work

- Builds on [Three-Layer Service Architecture](2026-03-15-165841-web-phase4-three-layer-service-architecture.md) — error handling is the natural complement to the service pattern
- Builds on [RPC Client IoC Bridge Package](2026-03-15-113318-rpc-client-ioc-bridge-package.md) — interceptors extend the existing transport
- Informed by Planton Web's error handling (interceptors, event buses, error scopes) — adopted classification pattern, rejected event bus and global modal patterns

---

**Status**: ✅ Production Ready
**Timeline**: Phase 5 of Web Architecture Alignment (T09)
