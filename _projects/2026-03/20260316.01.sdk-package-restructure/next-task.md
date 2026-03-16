# Next Task: 20260316.01.sdk-package-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260316.01.sdk-package-restructure

**Description**: Restructure Stigmer's SDK and TypeScript packages into a clean architecture: @stigmer/sdk (framework-agnostic TS client), @stigmer/react (consolidated React hooks and embeddable components), @stigmer/theme, and @stigmer/protos. Clean up Go SDK to target only 5 core resources (agent, skill, mcp-server, session, execution). Fix the broken npm release pipeline.
**Goal**: Establish the correct package segregation and release infrastructure so that platform builders can install @stigmer/sdk + @stigmer/react and integrate Stigmer into their products with minimal friction. Clean the Go SDK down to 5 resources with codegen-friendly structure. Evaluate whether codegen applies to TypeScript SDK as well.
**Tech Stack**: TypeScript/React, Go, Protobuf/Buf, npm workspaces, GitHub Actions
**Components**: sdk/go (Go SDK), sdk/typescript (TypeScript SDK), sdk/react (React package), client-apps/web/_libs/ui/theme (theme), scripts/publish-libs.mjs (release script), package.json (workspace config), .github/workflows/release.npm-libs.yaml (CI), apis/stubs/ts (proto stubs)

## Current Status

**Created**: 2026-03-16 09:59
**Last Session**: 2026-03-16 (Session 7) — Style isolation for @stigmer/react embeddable components
**Current Task**: All phases complete
**Status**: All phases complete. CSS Cascade Layer isolation, namespaced design tokens, and scoped preflight implemented. All 4 npm packages build and publish correctly. `tsc --noEmit` passes. `next build` compiles with 0 errors. Browser smoke test passes 9/9 checks.

## Session Progress (2026-03-16, Session 7)

### Completed: Style Isolation for @stigmer/react Embeddable Components (Phase 2B)

- Rejected CSS Modules migration in favor of CSS Layers + namespaced tokens + scoped preflight (industry-standard approach used by Stripe, Clerk, Mantine)
- Namespaced all 82 CSS custom properties in `@stigmer/theme/tokens.css` from `--x` to `--stgm-x`
- Restructured `sdk/react/src/styles.css`: granular `layer(stgm)` Tailwind imports, omitted preflight, added scoped reset
- Modified `StigmerProvider` to render `.stgm` wrapper div for style scoping
- Updated web console `globals.css` to reference `--stgm-*` tokens
- Changed `package.json` sideEffects to `["*.css"]`
- Verified: `tsc`, `next build`, `build:libs`, dry-run publish, browser smoke test (9/9 checks pass)

## Session Progress (2026-03-16, Session 6)

### Completed: Fix Turbopack `.js` Extension Resolution

- Updated Go codegen template (`sdk_client_ts.go`) to emit extensionless import paths — 15 sites fixed
- Regenerated `sdk/typescript/src/gen/` (20 files) with clean imports via `make codegen`
- Fixed handwritten imports in `sdk/typescript/src/` (6 files, ~50 imports)
- Fixed handwritten imports in `sdk/react/src/` (21 files, ~68 imports)
- Verified: `tsc --noEmit` passes in both `@stigmer/sdk` and `@stigmer/react`
- Verified: `next build` (Turbopack) compiles 0 errors, all 17 pages generated in 2.1s
- Committed as `4c21bd24`

## Session Progress (2026-03-16, Session 5)

### Completed: Cleanup + Release Pipeline Fix

- Deleted 6 deprecated workspace packages under `_libs/domain/` and `_libs/infra/` (~3,400 lines removed)
- Updated `_libs/README.md` to reflect current architecture (only `@stigmer/theme` remains)
- Removed stale `_libs/domain` and `_libs/infra` from `client-apps/web/tsconfig.json` exclude
- Fixed `build:libs` / `clean:libs` in root `package.json` to include all 4 publishable packages in dependency order
- Changed peer dep versions from `"0.0.0-dev"` to `"*"` for correct version pinning by `publish-libs.mjs`
- Created `tsconfig.build.json` for `@stigmer/theme` (was missing — needed for standalone compilation)
- Verified dry-run publish: all 4 packages build, generate correct `dist/package.json`, and pass `npm publish --dry-run`
- Committed as `904383fb`

### Surprise Finding: `next build` Turbopack Issue

`next build` fails with 41 errors in Turbopack because `.js` extensions in TypeScript source imports (e.g., `from "./components/AgentCard.js"`) are not resolved to `.ts` files. This is standard ESM convention and works with `tsc`, but Turbopack doesn't handle it for source-only workspace packages. Pre-existing issue from Session 2 codegen. Not caused by cleanup changes.

## Session Progress (2026-03-16, Session 2)

### Completed: TypeScript SDK — Codegen-Driven Client for All 17 Resources (Phase 1, Track A)

- Created `tools/codegen/generator/sdk_client_ts.go` (~1000 lines) — TypeScript code generator parallel to `sdk_client.go`
- Added `sdk-client-ts` target in `tools/codegen/generator/main.go`
- Generated 17 resource client files + `client.ts`, `types.ts`, `errors.ts` in `sdk/typescript/src/gen/`
- Handwritten infrastructure (~200 lines): `config.ts`, `transport.ts`, `internal/interceptors.ts`, `stigmer.ts`, `search.ts`, `index.ts`
- Package configuration: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `Makefile`
- Integrated into root `Makefile` protos target and root `package.json` workspaces
- TypeScript compilation passes with zero errors (`tsc --noEmit`)
- Committed as `6a98d9e4`

### Key Technical Decisions

- **`Object.assign(create(Schema), { data })` for proto builders**: Avoids protobuf-es v2 `MessageInit<T>` type-checking while correctly constructing messages at runtime. Zero `any` types.
- **Import resolution from `TypeSchema.ProtoFile`**: Correctly sources types from `spec_pb`, `io_pb`, `enum_pb`, `status_pb`, `metadata_pb` based on actual proto file paths.
- **`tsImportMethodType` function**: Handles cross-package types (commons), spec-defined types, and same-package IO types with correct module resolution.
- **Enum types always from `enum_pb`**: Consistent with the codebase proto file naming convention.
- **`Date | string` for Timestamp, `JsonObject` for Struct**: Type-safe SDK input types without forcing specific patterns.
- **Peer dependencies**: `@bufbuild/protobuf` and `@stigmer/protos` as peers to avoid duplicate protobuf runtimes.
- **Transport protocol choice**: gRPC-Web default, Connect protocol opt-in via `transport: "connect"` config option.

## Session Progress (2026-03-16, Session 3)

### Completed: Go SDK Publishable via `go get`

- Removed `replace` directive from `sdk/go/go.mod` — the monorepo-local path (`../../apis/stubs/go`) blocked external consumers
- Set stubs dependency to real tagged version `v0.0.35` (resolved via Go module proxy)
- Local development unaffected: `go.work` at repo root already handles monorepo resolution
- Extended `make release` to: update `sdk/go/go.mod` stubs version, commit, create `sdk/go/vX.Y.Z` tag, push
- Verified SDK builds with `GOWORK=off go build ./...` (simulates external consumer)
- Committed as `4e39cb7e`

## Session Progress (2026-03-16, Session 4)

### Completed: Phase 2 — @stigmer/react Consolidation

- Consolidated error utilities (`classifyError`, `getUserMessage`, `isRetryableError`, etc.) into `@stigmer/sdk`
- Created `@stigmer/react` package (`sdk/react/`) with `StigmerProvider`, `StigmerContext`, `useStigmer()` hook
- Migrated all domain packages (agent, session, agent-execution) into `@stigmer/react` with subpath exports
- Unified internal components (Badge, Collapsible, Button, Textarea, Section) into `@stigmer/react/src/internal/`
- Rewrote all React hooks to use `useStigmer()` + SDK client methods (eliminated domain service factories)
- Migrated web console (21 files): providers, hooks, pages, error handling
- Updated monorepo config: workspaces, transpilePackages, publish-libs, tsconfig excludes
- All three packages pass `tsc --noEmit` with zero errors

## Completed Phases

### Phase 1, Track B: Go SDK (Session 1)
- Removed Pulumi-style synthesis SDK
- Replaced with Stripe-style codegen-driven API client
- All 17 resources generated
- Committed as `81ded506` and `4005c0bb`

### Phase 1, Track A: TypeScript SDK (Session 2)
- Created `@stigmer/sdk` package with codegen-driven TypeScript clients
- All 17 resources generated, zero TypeScript errors
- Committed as `6a98d9e4`

### Go SDK Distribution Fix (Session 3)
- Made Go SDK publishable via standard `go get`
- Committed as `4e39cb7e`

### Phase 2: @stigmer/react Consolidation (Session 4)
- Migrated all domain packages into `@stigmer/react`
- Committed as `5c93fdf5`

### Cleanup + Phase 3: Release Pipeline (Session 5)
- Deleted deprecated packages, fixed build/publish pipeline
- Committed as `904383fb`

### Turbopack `.js` Extension Fix (Session 6)
- Removed `.js` from codegen template + all handwritten imports
- `next build` unblocked
- Committed as `4c21bd24`

### Phase 2B: Style Isolation for Embeddable Components (Session 7)
- CSS Cascade Layers, namespaced tokens, scoped preflight (no CSS Modules)
- Zero style leakage to host applications
- Zero component code changes required

## Next Steps

All phases are complete. This project is ready for final review and sign-off.

## Context for Resume

- The TypeScript SDK codegen pipeline: `proto2schema` (Stage 1: protos → JSON schemas) then `generator --target sdk-client-ts` (Stage 2: schemas → TS code)
- `make protos` in root now triggers proto stubs, Go SDK codegen, AND TypeScript SDK codegen
- The TypeScript generator handles 6 categories of import resolution: commons types, spec types, enum types, cross-package types, ID types, and standard IO types
- `sdk/typescript/src/gen/` is entirely managed by codegen; wiped and recreated on each `make codegen`
- The handwritten layer (`config.ts`, `transport.ts`, `interceptors.ts`, `stigmer.ts`, `search.ts`, `index.ts`) is stable and does not change when new resources are added
- IamPolicy is unusual: its Create/Delete methods take `IamPolicySpec` (the spec type) directly, not the full `IamPolicy` resource
- Some resources (Environment, McpServer, IdentityProvider) use the commons `ApiResourceId` for Get, not a resource-specific ID type
- `@stigmer/react` uses `useStigmer()` hook pattern — all data access goes through the `Stigmer` SDK client instance from context
- Old domain packages (`_libs/domain/*`, `_libs/infra/rpc-client`) have been deleted (Session 5)
- `StigmerTransportBridge` now creates a `Stigmer` client with `getAccessToken` callback and `onUnauthenticated` redirect handler, wrapped in `StigmerProvider`
- Error utilities live in `@stigmer/sdk` (framework-agnostic), not `@stigmer/react`
- `publish-libs.mjs` builds and publishes 4 packages in order: protos → sdk → theme → react
- All `@stigmer/*` cross-references use `"*"` version specifier, pinned to release version by `pinWorkspaceDeps()` at publish time

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260316.01.sdk-package-restructure/checkpoints/
```

### 2. Current Task
```
_projects/2026-03/20260316.01.sdk-package-restructure/tasks/
```

### 3. Design Decisions
```
_projects/2026-03/20260316.01.sdk-package-restructure/design-decisions/
```

### 4. Key Source Files
```
tools/codegen/generator/sdk_client_ts.go    — TypeScript generator
sdk/typescript/src/stigmer.ts               — Top-level SDK client
sdk/typescript/src/errors.ts               — Consolidated error utilities
sdk/react/src/provider.tsx                 — StigmerProvider component
sdk/react/src/hooks.ts                     — useStigmer() hook
sdk/react/src/agent/index.ts              — Agent domain exports
sdk/react/src/session/index.ts            — Session domain exports
sdk/react/src/agent-execution/index.ts    — Execution domain exports
scripts/publish-libs.mjs                  — npm release script
```

## Quick Commands

After loading context:
- "Continue with Phase 2B" — CSS Modules for embeddable components
- "Run codegen" — Regenerate after proto changes
- "Dry-run publish" — `node scripts/publish-libs.mjs --version 0.0.1-test.1 --dry-run`

---

*This file provides direct paths to all project resources for quick context loading.*
