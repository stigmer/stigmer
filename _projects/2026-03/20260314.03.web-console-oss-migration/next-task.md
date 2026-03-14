# Next Task: 20260314.03.web-console-oss-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Web Console OSS Migration

**Description**: Migrate the Stigmer Web Console from stigmer-cloud to stigmer OSS, add TypeScript proto codegen, make auth configurable, build for static export, embed in the CLI `stigmer server` command, and serve on port 8234.

**Goal**: Ship a web console embedded in `stigmer server` that provides browser-based agent execution monitoring, session management, and resource catalog — with zero external dependencies for local use and configurable auth for cloud deployment.

**Tech Stack**: TypeScript/Next.js 16/React 19, Go, Protobuf/Buf/Connect-RPC, TailwindCSS v4/shadcn-ui

**Components**: `client-apps/web` (new), `client-apps/cli` (server command, daemon), `backend/services/stigmer-server` (HTTP handler), `apis/` (TypeScript codegen)

## Task Plan

| Task | Title | Status |
|------|-------|--------|
| **T01** | Proto TypeScript Codegen Setup | ✅ DONE |
| **T02** | Migrate Web Source to Stigmer Repo | ✅ DONE |
| **T03** | Implement Configurable Auth | ✅ DONE |
| **T04** | Configure Static Export Build | ✅ DONE |
| **T05** | Embed Web Console in Daemon + gRPC-Web | ✅ DONE |
| **T06** | CLI Integration & Polish | ✅ DONE |
| **T07** | Build Pipeline & Dev Workflow | ✅ DONE |

## Key Architectural Decisions

- **Embedding**: Static export + `//go:embed` (zero Node.js runtime dependency)
- **Auth**: Optional, provider-agnostic (`disabled` for local, `oidc` for cloud)
- **Port**: 8234 for web console, 7234 for API (mirrors cloud topology)
- **Protos**: TypeScript codegen added to OSS (`apis/buf.gen.ts.yaml`)
- **Single codebase**: No separate web code in stigmer-cloud
- **Package manager**: npm workspaces (decided in T02)
- **Deployment artifacts**: Dockerfile and _kustomize/ kept in OSS (single codebase principle)
- **gRPC-Web**: Browser → API communication uses gRPC-Web (translated by `improbable-eng/grpc-web` on stigmer-server)
- **Embed location**: Web console embedded in CLI daemon (not stigmer-server) — cloud topology parity
- **Build tag**: `embed_webconsole` controls inclusion (lean dev builds, full release builds)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/checkpoints/
```

### 2. Current Task Plan
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/tasks/T01_0_plan.md
```

### 3. Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/README.md
```

## Knowledge Folders

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260314.03.web-console-oss-migration/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task

## Source Reference (stigmer-cloud)

The original web app being migrated lives at:
```
/Users/suresh/scm/github.com/stigmer/stigmer-cloud/client-apps/web/
```

Key files for reference during migration:
- `src/services/transport.ts` — Connect-RPC transport setup
- `src/components/auth/` — Auth components to be refactored
- `src/config/env.ts` — Environment/endpoint configuration
- `apis/buf.gen.ts.yaml` — TypeScript codegen config to replicate

## Session Progress (2026-03-14)

### T01 Completed: Proto TypeScript Codegen Setup
- Created `apis/buf.gen.ts.yaml` — Buf codegen config using `buf.build/bufbuild/es:v2.2.2` and `buf.build/connectrpc/es:v1.6.1`, pinned to match stigmer-cloud
- Created `apis/stubs/ts/package.json` — Internal `@stigmer/protos` ESM package with `@bufbuild/protobuf` dependency
- Updated `apis/Makefile` — Added `ts-stubs`, `ts-stubs-clean`, `ts-stubs-init` targets; wired into `build`, `clean`, `prep`, and `help`
- Updated `.gitignore` — Added global `node_modules/` exclusion
- Generated 169 TypeScript stubs (100% match with stigmer-cloud's current valid files)
- Found and fixed bug from stigmer-cloud: `ts-stubs-clean` was cleaning `com/` instead of `ai/`, causing 435 stale files

### T02 Completed: Migrate Web Source to Stigmer Repo
- Created root `package.json` with npm workspace declarations (`apis/stubs/ts`, `client-apps/web`)
- Copied 84 TypeScript source files + config + Dockerfile + _kustomize/ from stigmer-cloud
- Updated `package.json`: removed `next-auth`, rewired `@stigmer/protos` to `"*"` (npm workspace), moved `shadcn` to devDeps, simplified build script
- Updated `next.config.ts`: removed `output: "standalone"` and `outputFileTracingRoot`
- Stripped next-auth: deleted 4 auth files, rewrote 3 as no-op stubs (Providers, AuthGuard, useAuthSession)
- Removed `force-dynamic` from layout.tsx
- Verified: `npm install` (730 packages, 0 vulnerabilities), dev server starts, app shell renders in browser
- Created `client-apps/web/README.md`

### T03 Completed: Implement Configurable Auth
- Created `src/auth/` bounded module — 10 files across 3 directories (`auth/`, `auth/disabled/`, `auth/oidc/`)
- Core types: `AuthMode`, `AuthUser`, `AuthState`, `AuthConfig` in `types.ts`
- Config resolution: `config.ts` reads `NEXT_PUBLIC_AUTH_MODE`, defaults to `"disabled"`
- React context: `context.tsx` (AuthContext) separated from providers to prevent circular imports
- Public hook: `use-auth.ts` exports `useAuth()` — sole API for auth consumers
- Token store: `token-store.ts` moved from `src/lib/auth-token.ts` — bridges auth and transport
- Disabled provider: `disabled/DisabledAuthProvider.tsx` — always-authenticated, no token, no login/logout
- Auth guard: `AuthGuard.tsx` — uses `useAuth()`, passthrough in disabled mode, spinner + redirect in OIDC mode
- Top-level provider: `AuthProvider.tsx` — reads config, delegates to mode-specific provider
- OIDC types: `oidc/types.ts` — interface only (`OidcConfig`), implementation deferred to after T04
- Barrel export: `index.ts` — defines the module's public API
- Refactored `Providers.tsx`: `AuthProvider` > `AuthGuard` > `OrgProvider` nesting
- Updated transport import from `@/lib/auth-token` to `@/auth/token-store`
- Fixed API URL default from `localhost:8080` to `localhost:7234`
- Deleted: `useAuthSession.ts`, old `AuthGuard.tsx`, `auth-token.ts`
- Verified: dev server starts, zero errors, full app shell renders, navigation works

### T04 Completed: Configure Static Export Build
- Added `output: "export"` to `next.config.ts`
- Removed `export const dynamic = "force-dynamic"` from 13 page files (legacy from stigmer-cloud server-side auth)
- Split 4 dynamic `[id]` route pages into server `page.tsx` wrappers + client component files
- Server pages export `generateStaticParams` with `[{ id: "__placeholder__" }]` (Next.js 16 Cache Components rejects empty arrays)
- Client components colocated in same `[id]/` directory (e.g., `AgentDetailPage.tsx`)
- Updated `package.json` `start` script from `next start` to `npx serve out`
- Build produces `out/` directory: 14 static pages + 4 SSG pages with placeholder pre-renders
- Build completes in ~6 seconds, all routes verified with `npx serve`

### Key Decisions Made
- npm workspaces chosen over Yarn/pnpm (zero extra tooling, built into Node.js)
- `@connectrpc/connect` NOT declared in `@stigmer/protos` package.json (matches stigmer-cloud pattern; relies on workspace hoisting)
- Auth stub approach: minimal no-ops in T02, proper configurable auth in T03
- Dockerfile and _kustomize/ included (single codebase principle — cloud deploys from OSS)
- `src/auth/` as bounded module — auth types, config, context, providers, hooks, and guard colocated (not scattered across `components/`, `hooks/`, `lib/`)
- `useAuth()` as sole public API — components never import mode-specific providers or access token store directly
- Token store as auth-transport bridge — module-level variable, no React context in transport layer
- `user: null` in disabled mode — no synthetic "Local User" (components handle gracefully)
- OIDC implementation deferred — interface defined, but actual implementation waits for T04 (static export) to determine client-side vs server-side approach
- OrgProvider makes real gRPC calls in disabled mode — server has no auth, returns orgs without tokens; error state covers "server not running"
- Auth mode via `NEXT_PUBLIC_AUTH_MODE` env var — build-time config, extendable to runtime config in T05
- Dynamic `[id]` routes use server/client split — Next.js 16 Turbopack rejects `generateStaticParams` in `"use client"` files
- Placeholder params in `generateStaticParams` — Next.js 16 Cache Components rejects empty arrays; `[{ id: "__placeholder__" }]` is the workaround
- Runtime config deferred to T05 — `NEXT_PUBLIC_*` build-time vars work for both local and cloud
- `start` script changed to `npx serve out` — `next start` is incompatible with static export
- Web console embedded in daemon (not stigmer-server) — mirrors cloud where frontend and API are separate services
- gRPC-Web on stigmer-server using `improbable-eng/grpc-web` — browser cannot speak native gRPC
- h2c for protocol multiplexing — native gRPC (HTTP/2) and gRPC-Web (HTTP/1.1) on same port
- CORS allow-all for local dev — cloud handles CORS at proxy/CDN layer
- In-process goroutine for web server — static file server doesn't warrant subprocess overhead
- `StartHTTP()` in shared library, gRPC-Web wrapper in stigmer-server — generic vs specific separation

## Session Progress (2026-03-14 — Session 5)

### T05 Completed: Embed Web Console in Daemon with gRPC-Web Backend
- **gRPC-Web on stigmer-server**: Added `improbable-eng/grpc-web` wrapper with CORS. `StartHTTP()` in shared library uses h2c to multiplex native gRPC and gRPC-Web on port 7234. Zero changes to service controllers or interceptors.
- **Web console embed package**: Created `client-apps/cli/embedded/webconsole/` — three files: `webconsole.go` (interface), `webconsole_embed.go` (`//go:embed` with build tag), `handler.go` (SPA handler with cache control). Follows the agentrunner embedding pattern.
- **Daemon integration**: Web console served on port 8234 as in-process goroutine. Registered in `HealthState`. Graceful shutdown on daemon exit. Conditional on `webconsole.IsAvailable()`.
- **Build coordination**: `make web-console-build` builds web assets and copies to embed location. `make build-release` now includes both `embed_agentrunner` and `embed_webconsole` tags. `.gitignore` excludes build artifacts.
- **Critical discovery**: gRPC-Web protocol gap — browsers cannot speak native gRPC. This was not covered in the original project plan and required collaborative architectural decision-making.

## Session Progress (2026-03-14 — Session 6)

### T06 Completed: CLI Integration & Polish
- **Shared browser utility**: Extracted `openBrowser()` from `auth/browser.go` into shared `internal/cli/browser/open.go`. Updated `auth/login.go` import. Deleted old file.
- **`stigmer server` output**: Web console URL shown in both human and structured (JSON/quiet) output under "Web UI", conditional on health state.
- **`stigmer server status`**: Added `web-console` to component list. Only displayed when health state entry exists (optional component — no misleading "Not Running" for builds without embed tag or `--no-web`).
- **`--no-web` flag**: `server.go` flag → `StartOptions.NoWeb` → `STIGMER_NO_WEB=1` env var → `daemon_process.go` skips web console startup, records `stopped` state.
- **`--open` flag**: Opens web console URL in default browser after server startup (opt-in, not auto-open). Graceful failure with warning.
- **Fallback health probe**: TCP probe to port 8234 in `createBasicHealthState()`. Only records component when reachable.
- **Key decisions**: Deferred `--web-port` (YAGNI — requires runtime config, CORS, API port coordination). Chose explicit `--open` over auto-open (CI-safe, non-intrusive).

## Session Progress (2026-03-14 — Session 7)

### T07 Completed: Build Pipeline & Dev Workflow
- **Root Makefile**: Added web console artifacts to `clean` target (`rm -rf client-apps/cli/embedded/webconsole/out/`, `rm -rf client-apps/web/out/ client-apps/web/.next/`). Added ESLint for `client-apps/web` to `lint` target with graceful skip when `node_modules` not present.
- **CI workflow (`release.cli.yaml`)**: Added `build-web-console` job that runs in parallel with `lint-and-typecheck-agent-runner` — checks out repo, generates TypeScript proto stubs via Buf, sets up Node.js 22, runs `npm ci`, lints, builds, and uploads `client-apps/web/out/` as `web-console-assets` artifact. Updated all 3 platform build jobs (`build-darwin-arm64`, `build-darwin-amd64`, `build-linux-amd64`) to depend on `build-web-console`, download the artifact into the embed location, and compile with `embed_agentrunner embed_webconsole` build tags.
- **Dockerfile rewrite**: Multi-stage build — builder stage (`node:22-alpine`) with `ARG`→`ENV` pattern for `NEXT_PUBLIC_AUTH_MODE` and `NEXT_PUBLIC_API_URL`, npm workspaces install and build; runtime stage (`nginx:alpine`) serving static files on port 3000 with OCI labels.
- **nginx.conf**: Created SPA routing config — hashed asset caching (`Cache-Control: immutable`), `index.html` revalidation (`no-cache`), SPA fallback with `.html` suffix support for Next.js static export routes.
- **Kustomize cleanup**: Updated image repo from `stigmer-cloud` to `stigmer`. Removed stale Auth0/NextAuth env vars and secrets from all overlays. Right-sized resource limits for nginx (64Mi/128Mi memory vs. previous 500Mi/2Gi). Added comments clarifying `NEXT_PUBLIC_*` is build-time only.
- **README.md**: Fixed API URL default (8080→7234). Added documentation for three workflow modes: web-only dev (hot reload), full release build (CLI embedding), Docker build (cloud deployment with build args).
- **Key discovery**: `NEXT_PUBLIC_*` variables are build-time only for static exports — they cannot be overridden at runtime via Kubernetes env vars. Dockerfile uses `ARG`→`ENV` pattern so Docker build args are available to the Next.js build process. Kustomize env var overrides for these variables are misleading and were removed.
- **Key decision**: No `release.web.yaml` workflow needed — cloud deployment handled by Planton (confirmed by checking stigmer-cloud had no such workflow).

## Current Status

**Created**: 2026-03-14
**Current Task**: All tasks complete (T01–T07)
**Status**: ✅ Project complete — all 7 tasks delivered

## Next Steps

All planned tasks for the Web Console OSS Migration project are complete. Potential follow-up work:
1. End-to-end testing of the full release pipeline (trigger CI on `ref/migrate-web-to-oss` branch)
2. OIDC auth provider implementation (interface defined in T03, implementation deferred)
3. Address pre-existing code quality issue: Connect-RPC service files use `any` cast
4. Merge `ref/migrate-web-to-oss` branch to main

## Context for Resume
- Branch: `ref/migrate-web-to-oss`
- All 7 tasks complete — project is ready for review and merge
- TypeScript codegen: `make ts-stubs` from `apis/` directory
- Web app: `npm run dev -w client-apps/web` starts on port 3000
- Auth: bounded module at `src/auth/` with disabled (local) and OIDC (cloud) modes
- Static export: `npm run build -w client-apps/web` → `out/` directory
- CLI embedding: `make build-release` → binary with `embed_agentrunner embed_webconsole`
- CI: `build-web-console` job builds once, platform jobs download artifact
- Docker: multi-stage build with `ARG`→`ENV` for build-time config, nginx runtime
- Kustomize: cleaned overlays, right-sized for nginx, no stale Auth0 references
- gRPC-Web: stigmer-server handles browser→API via h2c multiplexing on port 7234
- Daemon: web console on port 8234 (conditional, `--no-web` to disable, `--open` to auto-launch browser)

## Quick Commands

- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*Drag this file into any chat to resume work on this project.*
