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
**Current Task**: ALL TASKS COMPLETED
**Status**: Complete
**Last Session**: 2026-03-15 — Completed T06 (audit and fix npm publishing pipeline)

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

### T03: Create @stigmer/theme (UI Layer) — COMPLETED

Accomplished:
- Created `_libs/ui/theme/src/utils.ts` with `cn()` utility and `ClassValue` type re-export
- Created `_libs/ui/theme/src/tokens.css` with all 35+ oklch CSS custom properties (`:root` light + `.dark` overrides)
- Updated `_libs/ui/theme/src/index.ts` barrel export (`cn`, `ClassValue`)
- Added `"./tokens.css"` subpath export in `package.json` for CSS imports
- Updated `src/app/globals.css` to `@import "@stigmer/theme/tokens.css"` (single source of truth)
- Verified: `npm install` resolves, `npm run build` passes (18 pages, zero errors)

Key decisions:
- **Tokens only** extracted from `globals.css`: `:root` and `.dark` CSS variable blocks moved to theme package
- **`@theme inline` stays** in `globals.css`: It's Tailwind v4 configuration (bridges CSS vars to utility classes) and references Next.js font variables (`--font-geist-sans`, `--font-geist-mono`) — moving it would couple theme to Next.js font infrastructure
- **`@custom-variant dark` stays** in `globals.css`: Tailwind dark mode strategy, not a design token
- **`ClassValue` re-exported**: Downstream packages (`@stigmer/react-ui`) can type `className` props without direct `clsx` dependency
- **No React theme context**: Stigmer uses Tailwind's CSS-class-based dark mode; no JS mode bridging needed (unlike Planton's MUI-based approach)
- **No `cva`/`VariantProps` re-export**: CVA is a component authoring tool, not a theme concern — components import it directly
- CSS `@import` of workspace packages through Tailwind v4 PostCSS pipeline confirmed working (technical risk from plan resolved)

### T04: Create @stigmer/react-ui with Execution Module — COMPLETED

Accomplished:
- Moved all 8 execution components (`ExecutionStream`, `ExecutionStatus`, `MessageEntry`, `MessageInput`, `OutputBlock`, `ToolCallCard`, `SubAgentCard`, `ApprovalControls`) to `_libs/domain/react-ui/src/execution/components/`
- Created `createExecutionService(transport)` factory replacing module-level singleton transport
- Created `useExecutionService()` hook bridging to `useStigmerTransport()` from `@stigmer/rpc-client`
- Created library versions of `useAgentExecution` and `useApproval` hooks using the new service factory
- Moved all execution helpers (phase/status/message/duration utilities) to `helpers.ts`
- Vendored 4 shadcn components (`Badge`, `Button`, `Collapsible`, `Textarea`) as `internal/ui/`
- Set up `./execution` subpath export and configured `package.json` with deps/peerDeps
- Replaced console's `src/components/execution/index.ts` with proxy re-exports from `@stigmer/react-ui/execution`
- Verified: `npm install`, `npm run build` (18 pages, zero errors), `npm run lint` (zero errors)

Key decisions:
- **Dropped StigmerExecutionContext**: Components already pass callbacks via props (2-3 levels deep). Context would be overengineering. Props are explicit and testable.
- **Service factory pattern**: `createExecutionService(transport)` is a pure factory. `useExecutionService()` is a thin hook wrapper. The `any` casts for protobuf-es codegen stay encapsulated inside the factory.
- **Vendored shadcn**: Self-contained library. `@base-ui/react` and `class-variance-authority` as peer deps.
- **Session services stay in console**: Session browsing is a console feature. Only execution CRUD/subscription moved.
- **Temporary duplication**: Console's old hooks/services use singleton transport. Library's new versions use IoC. T05 removes the console copies and wires up `StigmerTransportProvider`.

### T05: Migrate Stigmer Web Console to @stigmer/* Packages — COMPLETED

Accomplished:
- **Phase 1 — Wired StigmerTransportProvider**: Created `StigmerTransportBridge` component that bridges `useAuth()` + `getApiBaseUrl()` into `StigmerTransportProvider`. Placed after `AuthGuard` in `Providers.tsx` so auth is resolved before transport initialization.
- **Phase 2 — Migrated execution consumers**: Updated `run/page.tsx`, `DraftPage.tsx`, `SessionDetailPage.tsx` to import all execution components/hooks/helpers from `@stigmer/react-ui/execution`. Refactored `useSessionDetail.ts` to use `useExecutionService()` hook instead of bare `listExecutionsBySession` function.
- **Phase 3 — Migrated cn() imports**: Updated `components.json` shadcn alias to `@stigmer/theme`. Changed `cn` imports in 7 shadcn components + 6 app files from `@/lib/utils` to `@stigmer/theme`.
- **Phase 4 — Deleted dead code**: Removed entire `src/components/execution/` directory (9 files), `src/hooks/useAgentExecution.ts`, `src/hooks/useApproval.ts`, `src/services/execution-service.ts`. Verified with `grep` that no stale imports remain.
- **Build + lint**: All four phases verified with `npm run build` (zero errors) and `npm run lint` (zero errors/warnings)

31 files changed: 53 insertions, 1,208 deletions (net reduction of ~1,155 lines from the console).

Key decisions:
- **Two transport paths (temporary)**: Console now has `StigmerTransportProvider` for execution (via library) and legacy singleton `transport.ts` for 6 non-execution services. Unifying these is a future task.
- **`useSessionDetail` refactored to use `useExecutionService()`**: The hook previously called `listExecutionsBySession` as a bare function import. Since the library exposes this via a hook-returned service object, the internal structure was updated — a structural change, not just an import rename.
- **`lib/utils.ts` and `lib/execution.ts` already absent**: These files referenced in the plan did not exist on this branch. Only the files that existed were deleted.
- **`transport.ts` and `token-store.ts` intentionally kept**: Still depended on by session, draft, catalog, and auth services. Out of scope for T05.

### T06: Audit and Fix npm Publishing Pipeline — COMPLETED

Accomplished:
- **Fixed critical double-publish bug**: Root `Makefile`'s `release` target was calling `libs-publish` locally AND the `v*` tag push triggered `release.npm-libs.yaml` CI workflow to publish the same version. Removed local publish; CI is now the sole publisher.
- **Added package metadata**: `license: "Apache-2.0"`, `engines: { node: ">=18" }`, and relevant `keywords` to all 4 packages (`@stigmer/protos`, `@stigmer/rpc-client`, `@stigmer/theme`, `@stigmer/react-ui`).
- **Fixed repository.url format**: Changed from `https://` to `git+https://` across all packages, eliminating npm auto-correction warnings.
- **Enhanced publish script** (`scripts/publish-libs.mjs`): Now propagates `license`, `engines`, `keywords` into generated `dist/package.json`. Copies `src/` into `dist/src/` for declaration map IDE navigation. Copies root `LICENSE` file into each published package.
- **Fixed build config**: Changed `module: "esnext"` to `"ES2022"` in `tsconfig.base.json` for stable emit behavior. Changed `npx @tailwindcss/cli` to `tailwindcss` in react-ui build script.
- **Verified `buf/` necessity**: Proto stubs import from `buf/validate/` — directory must stay in build.
- **Created README.md** for all 4 packages with install instructions, usage examples, and API summaries.
- **End-to-end validated**: Full clean + build + dry-run publish for all 4 packages — zero errors, correct contents (LICENSE, README, src/, all metadata fields).

Key decisions:
- **Ship source (Option A)**: `src/` is copied into `dist/src/` so `.d.ts.map` declaration maps resolve to readable TypeScript. Package sizes remain small (11-44KB compressed).
- **`buf/` stays in protos tsconfig**: Multiple proto stubs import from `buf/validate/` paths — removing it breaks the build.
- **CI owns publishing**: `make release` pushes tags; CI workflows handle the actual npm publish and GitHub release. No local publishing.

## Task Plan Status

| Task | Title | Status |
|------|-------|--------|
| **T01** | Set up _libs directory structure and workspace config | **COMPLETED** |
| **T02** | Create @stigmer/rpc-client (infra layer) | **COMPLETED** |
| **T03** | Create @stigmer/theme (ui layer) | **COMPLETED** |
| **T04** | Create @stigmer/react-ui with execution module (domain layer) | **COMPLETED** |
| **T05** | Migrate Stigmer web console to consume @stigmer packages | **COMPLETED** |
| **T06** | Audit and fix npm publishing pipeline | **COMPLETED** |

## Project Complete

All 6 tasks finished. The `@stigmer/*` packages are:
- Structured in 3 layers (infra/ui/domain) with clean dependency rules
- Consumed by the web console (zero local execution code remains)
- Ready to publish to npm via CI on tag push
- Published with full metadata (license, engines, keywords, README, LICENSE, source maps)

## Context for Future Work

- All three `_libs` layers implemented and the console now consumes them: infra (`@stigmer/rpc-client`), ui (`@stigmer/theme`), domain (`@stigmer/react-ui`)
- `StigmerTransportBridge` wires `useAuth()` → `StigmerTransportProvider` in the provider tree (after `AuthGuard`)
- Console execution pages import exclusively from `@stigmer/react-ui/execution` — zero local execution code remains
- `cn()` imports across 13 files point to `@stigmer/theme`; `components.json` alias updated for future shadcn adds
- npm publishing pipeline fully configured: `make release` pushes tags → CI builds + publishes packages
- **Two transport paths (temporary)**: Execution uses `StigmerTransportProvider`. Six non-execution services still use singleton `transport.ts` + `token-store.ts`. Unifying is a future task.

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260315.01.web-libs-setup/checkpoints/2026-03-15-session-6.md
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

---

*Project complete. All 6 tasks finished.*
