# Next Task: 20260315.01.web-libs-setup

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260315.01.web-libs-setup

**Description**: Set up the _libs pattern in Stigmer web app — workspace packages for reusable, publishable React components. Extract existing execution components into @stigmer/react-ui as the first library. Establish frontend patterns (IoC bridge, pipeline framework) matching Planton's proven approach.
**Goal**: Platform owners can install @stigmer/react-ui from npm and embed agent execution UI in their apps with ~5 lines of code. Stigmer's own web console is the first consumer.
**Tech Stack**: TypeScript, React 19, Next.js 16, Tailwind CSS v4, shadcn-ui, Connect-RPC (gRPC-Web), npm workspaces
**Components**: client-apps/web (components/execution, services, hooks, lib), new client-apps/web/_libs/ directory

## Current Status

**Created**: 2026-03-15 10:31
**Current Task**: T03 (Create @stigmer/theme)
**Status**: Ready to start

## Session Progress (2026-03-15)

### T01: Set Up _libs Directory Structure and Workspace Config — COMPLETED

Accomplished:
- Created `client-apps/web/_libs/` three-layer directory structure (infra, ui, domain)
- Created `tsconfig.base.json` with strict TypeScript settings (deviating from Planton's lax `strict: false`)
- Created `_libs/README.md` documenting architecture, dependency rules, and how-to-add-a-package
- Scaffolded 3 skeleton packages: `@stigmer/rpc-client`, `@stigmer/theme`, `@stigmer/react-ui`
- Updated root `package.json` with workspace globs for automatic package discovery
- Added `transpilePackages` to `next.config.ts` for SWC compilation of source-only packages
- Added ESLint `@/` import restriction targeting `_libs/**` (flat config format)
- Verified `npm install` creates correct workspace symlinks under `node_modules/@stigmer/`
- Verified `npm run build` passes (18 static pages, zero errors)

Key decisions:
- Directory naming: `domain/react-ui/` (matches package name), not `domain/execution/` (plan's original)
- Used `"*"` dependencies (npm convention), not `workspace:*` (yarn/pnpm only)
- ESLint flat config override (one linting system), not standalone `.eslintrc.yml`
- `strict: true` in tsconfig.base.json (Stigmer quality standard)
- No `declaration`/`declarationMap`/`sourceMap` (source-only; T06 concern)

### T02: Create @stigmer/rpc-client (Infra Layer) — COMPLETED

Accomplished:
- Implemented `@stigmer/rpc-client` with 6 source modules + barrel export
- `types.ts`: `StigmerRpcConfig` interface with `serverUrl`, `getAccessToken` callback, optional `interceptors`
- `interceptors.ts`: `createAuthInterceptor` (Bearer token per-request) and `errorStripInterceptor` (gRPC code prefix removal)
- `transport.ts`: `createStigmerTransport()` pure factory — no React, no state, testable in isolation
- `context.ts`: `StigmerTransportContext` (separate file to prevent circular imports, matching `src/auth/context.tsx` pattern)
- `provider.tsx`: `StigmerTransportProvider` — creates and distributes transport via context
- `hooks.ts`: `useStigmerTransport()` (throws if no provider) and `useServiceClient(service)` (typed client factory)
- `index.ts`: Barrel with all public exports + re-exports from `@connectrpc/connect` and `@bufbuild/protobuf`
- Verified: `npm install` resolves, `npm run build` passes (18 pages, zero errors), ESLint clean (zero errors/warnings)

Architecture decision: **React Context + Imperative Factory**
- Replaces the module-level singleton transport with an IoC bridge pattern
- `getAccessToken` callback replaces the mutable `token-store.ts` (consumers provide auth; library never reads env/state directly)
- `createStigmerTransport()` available for non-React usage (tests, scripts)

Key decisions:
- `DescService` comes from `@bufbuild/protobuf`, not `@connectrpc/connect` (discovered during build verification)
- Provider uses standard `useMemo` with explicit deps instead of ref-based callback pattern (React 19's `react-hooks/refs` rule forbids ref access during render; the ref pattern triggers lint errors)
- Consumers stabilize `getAccessToken` via `useCallback` — standard React practice, documented in JSDoc
- `env.ts` NOT extracted (server URL provided by consumer via IoC, not read from env vars)
- `token-store.ts` NOT deleted (still used by existing services; removed in T05)
- Deliberately omitted Planton's event buses, notification integration, env info, and local error scopes (premature for Stigmer's current needs)

## Task Plan Status

| Task | Title | Status |
|------|-------|--------|
| **T01** | Set up _libs directory structure and workspace config | **COMPLETED** |
| **T02** | Create @stigmer/rpc-client (infra layer) | **COMPLETED** |
| **T03** | Create @stigmer/theme (ui layer) | PENDING |
| **T04** | Create @stigmer/react-ui with execution module (domain layer) | PENDING |
| **T05** | Migrate Stigmer web console to consume @stigmer packages | PENDING |
| **T06** | Set up npm publishing (build tooling, CI) | PENDING |

## Next Steps

1. **T03**: Extract `cn()` utility and CSS design tokens into `@stigmer/theme`. Decide how much of `globals.css` moves vs stays.
2. **T04**: Extract execution components into `@stigmer/react-ui`. Wire the IoC bridge using the `useServiceClient` hook from `@stigmer/rpc-client`.
3. T03 is a prerequisite for T04 (execution components use `cn()`).

## Context for Resume

- `@stigmer/rpc-client` is fully implemented with IoC bridge pattern (React Context + imperative factory)
- The console bridge component (`StigmerClientBridge`) will be created in T05 to wire `useAuth()` → `StigmerTransportProvider`
- Existing `src/services/*.ts` files still use the old singleton transport — they migrate in T05
- The plan file is at `_projects/2026-03/20260315.01.web-libs-setup/tasks/T01_0_plan.md` — T03-T06 details are all there
- For T03: study `src/lib/utils.ts` (cn utility) and `src/app/globals.css` (CSS tokens) to determine extraction scope

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260315.01.web-libs-setup/checkpoints/2026-03-15-session-2.md
```

### 2. Task Plan
```
_projects/2026-03/20260315.01.web-libs-setup/tasks/T01_0_plan.md
```

### 3. Design Decisions
```
_projects/2026-03/20260315.01.web-libs-setup/design-decisions/001-libs-pattern-over-new-protocol.md
```

### 4. Don't Dos
```
_projects/2026-03/20260315.01.web-libs-setup/dont-dos/001-no-protocol-invention.md
```

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260315.01.web-libs-setup/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
