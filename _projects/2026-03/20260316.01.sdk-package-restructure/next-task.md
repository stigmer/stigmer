# Next Task: 20260316.01.sdk-package-restructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260316.01.sdk-package-restructure

**Description**: Restructure Stigmer's SDK and TypeScript packages into a clean architecture: @stigmer/sdk (framework-agnostic TS client), @stigmer/react (consolidated React hooks and embeddable components), @stigmer/theme, and @stigmer/protos. Clean up Go SDK to target only 5 core resources (agent, skill, mcp-server, session, execution). Fix the broken npm release pipeline.
**Goal**: Establish the correct package segregation and release infrastructure so that platform builders can install @stigmer/sdk + @stigmer/react and integrate Stigmer into their products with minimal friction. Clean the Go SDK down to 5 resources with codegen-friendly structure. Evaluate whether codegen applies to TypeScript SDK as well.
**Tech Stack**: TypeScript/React, Go, Protobuf/Buf, npm workspaces, GitHub Actions
**Components**: sdk/go (Go SDK), sdk/typescript (TypeScript SDK), client-apps/web/_libs/domain (React domain packages), client-apps/web/_libs/infra (rpc-client), scripts/publish-libs.mjs (release script), package.json (workspace config), .github/workflows/release.npm-libs.yaml (CI), apis/stubs/ts (proto stubs)

## Current Status

**Created**: 2026-03-16 09:59
**Last Session**: 2026-03-16 — Completed Phase 2 (@stigmer/react consolidation)
**Current Task**: Phase 2B (CSS Modules for embeddable components) or Phase 3 (release pipeline)
**Status**: Phases 1 and 2 complete. SDK, React package, and web console all compile cleanly.

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

### Generator Bug Fixes (iterative debugging cycle)

Six categories of generator bugs were identified and fixed during the initial compilation:
1. Duplicate `ApiResourceIdSchema` imports from resource io_pb (when cfg.idType is commons type)
2. Wrong enum import paths using `v1_pb` instead of `enum_pb`
3. Cross-package type imports missing (`FindApiResourcesRequest`, `ApiResourceAuditActor`)
4. Spec types imported from `io_pb` instead of `spec_pb` (`IamPolicySpecSchema`, `ApiResourceRefSchema`)
5. Builder function type mismatches (`EnvSpecInput` vs `MessageInit<EnvironmentSpec>`, etc.)
6. Non-Get ID type schemas not imported (`IdpIdSchema`)

### Files Created/Modified

- `tools/codegen/generator/sdk_client_ts.go` — new, TypeScript code generator
- `tools/codegen/generator/main.go` — modified, added `sdk-client-ts` target
- `sdk/typescript/` — entire new package (37 files)
- `Makefile` — added `sdk/typescript codegen` to protos target
- `package.json` — added `sdk/typescript` to workspaces
- `_changelog/2026-03/2026-03-16-123359-typescript-sdk-codegen-all-resources.md` — changelog

## Session Progress (2026-03-16, Session 3)

### Completed: Go SDK Publishable via `go get`

- Removed `replace` directive from `sdk/go/go.mod` — the monorepo-local path (`../../apis/stubs/go`) blocked external consumers
- Set stubs dependency to real tagged version `v0.0.35` (resolved via Go module proxy)
- Local development unaffected: `go.work` at repo root already handles monorepo resolution
- Extended `make release` to: update `sdk/go/go.mod` stubs version, commit, create `sdk/go/vX.Y.Z` tag, push
- Verified SDK builds with `GOWORK=off go build ./...` (simulates external consumer)
- Committed as `4e39cb7e`

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

### Key Decision: CSS Strategy Deferred to Phase 2B

Tailwind-to-CSS-Modules migration for embeddable component style encapsulation is a separate workstream. Phase 2 focused purely on package consolidation and SDK integration to minimize blast radius.

## Next Steps

1. **Phase 2B: CSS Modules for embeddable components**
   - Migrate from Tailwind to CSS Modules for style encapsulation
   - Ensure `@stigmer/react` components don't leak styles into host applications
2. **Phase 3: Release pipeline + npm cleanup**
   - Verify `scripts/publish-libs.mjs` works with new package paths
   - Update `.github/workflows/release.npm-libs.yaml`
   - Test end-to-end `next build`
3. **Cleanup: Remove old packages**
   - Delete `client-apps/web/_libs/domain/` directories
   - Delete `client-apps/web/_libs/infra/rpc-client/` directory
   - Verify no remaining references

## Context for Resume

- The TypeScript SDK codegen pipeline: `proto2schema` (Stage 1: protos → JSON schemas) then `generator --target sdk-client-ts` (Stage 2: schemas → TS code)
- `make protos` in root now triggers proto stubs, Go SDK codegen, AND TypeScript SDK codegen
- The TypeScript generator handles 6 categories of import resolution: commons types, spec types, enum types, cross-package types, ID types, and standard IO types
- `sdk/typescript/src/gen/` is entirely managed by codegen; wiped and recreated on each `make codegen`
- The handwritten layer (`config.ts`, `transport.ts`, `interceptors.ts`, `stigmer.ts`, `search.ts`, `index.ts`) is stable and does not change when new resources are added
- IamPolicy is unusual: its Create/Delete methods take `IamPolicySpec` (the spec type) directly, not the full `IamPolicy` resource
- Some resources (Environment, McpServer, IdentityProvider) use the commons `ApiResourceId` for Get, not a resource-specific ID type
- `@stigmer/react` uses `useStigmer()` hook pattern — all data access goes through the `Stigmer` SDK client instance from context
- Old domain packages (`_libs/domain/*`, `_libs/infra/rpc-client`) still on disk but excluded from tsconfig and workspaces. Safe to delete.
- `StigmerTransportBridge` now creates a `Stigmer` client with `getAccessToken` callback and `onUnauthenticated` redirect handler, wrapped in `StigmerProvider`
- Error utilities live in `@stigmer/sdk` (framework-agnostic), not `@stigmer/react`

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
```

## Quick Commands

After loading context:
- "Continue with Phase 2B" — CSS Modules for embeddable components
- "Continue with Phase 3" — Release pipeline fixes
- "Delete old packages" — Remove deprecated domain/infra dirs
- "Run codegen" — Regenerate after proto changes

---

*This file provides direct paths to all project resources for quick context loading.*
