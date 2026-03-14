# Migrate Web Console to Stigmer OSS

**Date**: March 14, 2026

## Summary

Migrated the Stigmer Web Console from stigmer-cloud to the stigmer OSS repository, establishing npm workspaces for monorepo package resolution, stripping the Auth0/next-auth hard dependency, and verifying the full application compiles and renders. This is the foundation for embedding the web console in `stigmer server` for zero-dependency local use.

## Problem Statement

The Stigmer Web Console lived exclusively in the stigmer-cloud repository, tightly coupled to Auth0 via next-auth. This meant:

### Pain Points

- Local users of `stigmer server` had no browser-based UI for monitoring agent executions, managing sessions, or browsing the resource catalog
- The web console could not be embedded in the Go binary because it was in a separate repo with cloud-specific dependencies
- Auth was hardcoded to Auth0 — no path to running without authentication for local development
- TypeScript proto stubs were only generated in stigmer-cloud, duplicating build infrastructure

## Solution

Copied the full Next.js 16 web console into `client-apps/web/` in the stigmer OSS repo, wired it into the existing proto codegen pipeline via npm workspaces, and replaced the next-auth layer with minimal no-op stubs so the app compiles and runs without any auth provider.

## Implementation Details

### npm Workspaces

Created a root `package.json` declaring two workspaces:
- `apis/stubs/ts` — the `@stigmer/protos` package (generated TypeScript protobuf stubs from T01)
- `client-apps/web` — the web console application

npm automatically symlinks `@stigmer/protos` into the web app's dependency tree, replacing Yarn's `workspace:*` protocol with standard npm workspace resolution.

### Auth Stripping

Surgically removed next-auth while preserving the auth boundary for T03 to implement configurable auth:

- **Deleted**: NextAuth API route, AuthTokenSync component, next-auth type augmentations, logged-out page
- **Stubbed**: `Providers.tsx` (renders OrgProvider directly), `AuthGuard.tsx` (pass-through), `useAuthSession.ts` (returns always-unauthenticated)
- **Untouched**: `auth-token.ts` and `transport.ts` (independent of next-auth, work as-is)

### Configuration Changes

- `next.config.ts`: removed `output: "standalone"` and `outputFileTracingRoot` (container-deployment config)
- `layout.tsx`: removed `export const dynamic = "force-dynamic"` (auth-dependent server rendering)
- `package.json`: removed `next-auth`, rewired `@stigmer/protos`, moved `shadcn` CLI to devDeps

### What Was Preserved

The Dockerfile and `_kustomize/` deployment manifests were included — following the single-codebase principle where cloud deploys the same code from the same repo.

## Benefits

- **Single codebase**: Web console code lives in one place, deployed to both local (embedded) and cloud (Kubernetes) from the same source
- **Zero auth dependency**: App compiles and runs without any authentication provider — foundation for `authMode: disabled` in local mode
- **Workspace resolution**: `@stigmer/protos` resolves via npm workspace symlink, no version pinning or publishing needed
- **Dev workflow**: `npm run dev -w client-apps/web` starts the console on port 3000 with hot reload

## Impact

- **Developers**: Can now run `npm run dev` in the OSS repo to work on the web console
- **T03-T07**: All subsequent tasks (configurable auth, static export, Go embedding, CLI integration) now have a working foundation to build on
- **stigmer-cloud**: Can eventually remove its web source and point cloud deployment at the OSS repo

## Related Work

- T01 (Proto TypeScript Codegen Setup) — prerequisite that generated `@stigmer/protos`
- T03 (Implement Configurable Auth) — next task, will replace no-op stubs with `useAuth()` abstraction
- T04 (Configure Static Export Build) — will add `output: "export"` for Go embedding
- T05 (Embed Web UI in stigmer-server) — will serve the built SPA via `//go:embed`

---

**Status**: ✅ Production Ready (as migration foundation — auth and embedding are subsequent tasks)
**Timeline**: ~2 hours
