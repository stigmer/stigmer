# Task T01: Proto TypeScript Codegen Setup

**Created**: 2026-03-14
**Completed**: 2026-03-14
**Status**: ✅ DONE
**Estimated effort**: 2-3 hours

## Objective

Add TypeScript/Connect-RPC codegen to the stigmer OSS build pipeline so the web console can consume type-safe generated stubs from the same proto definitions used by Go and Python.

## Context

Today, TypeScript stubs are generated only in stigmer-cloud via `apis/buf.gen.ts.yaml` using `protobuf-es` + `Connect-RPC` plugins. The OSS repo has `buf.gen.go.yaml` and `buf.gen.python.yaml` but no TypeScript codegen. Since the web console is moving to OSS, the stubs must be generated here.

## Deliverables

1. **`apis/buf.gen.ts.yaml`** — Buf codegen config for TypeScript
   - Plugin: `buf.build/bufbuild/es` (protobuf-es v2) for message types
   - Plugin: `buf.build/connectrpc/es` for Connect-RPC service clients
   - Output: `apis/stubs/ts/`

2. **Makefile target** — `make ts-stubs` added to `apis/Makefile`
   - Integrated into the existing `make protos` / `make build` workflow
   - Generates stubs into `apis/stubs/ts/`

3. **Package manifest** — `apis/stubs/ts/package.json`
   - Package name: `@stigmer/protos` (internal workspace package)
   - Exports map: `"./*": "./*.ts"` (path-based exports)
   - Runtime deps: `@bufbuild/protobuf`, `@connectrpc/connect`

4. **Validation** — Generated stubs compile and match the Go stubs structurally

## Approach

- Mirror the existing `buf.gen.ts.yaml` from stigmer-cloud
- Add to the `apis/Makefile` alongside existing `go-stubs` and `python-stubs` targets
- Ensure `apis/buf.yaml` excludes `stubs/ts/` from lint/breaking checks (it already excludes `stubs`)
- Run `buf generate` and verify output matches stigmer-cloud's generated stubs

## Dependencies

- Buf CLI installed (already required for Go/Python codegen)
- `buf.build/bufbuild/es` and `buf.build/connectrpc/es` remote plugins (no local install needed)

## Risks

- None significant — this is additive and mirrors an existing working setup

## Files Changed

- `apis/buf.gen.ts.yaml` (new)
- `apis/Makefile` (modified — add `ts-stubs` target)
- `apis/stubs/ts/package.json` (new)
- `apis/stubs/ts/**/*_pb.ts`, `*_connect.ts` (generated)

---

# Full Project Task Overview

This is the first of 7 tasks in the web-console-oss-migration project:

| Task | Title | Status | Est. Effort |
|------|-------|--------|-------------|
| **T01** | Proto TypeScript Codegen Setup | ✅ DONE | 2-3 hrs |
| **T02** | Migrate Web Source to Stigmer Repo | ⏸️ TODO | 3-4 hrs |
| **T03** | Implement Configurable Auth | ⏸️ TODO | 3-4 hrs |
| **T04** | Configure Static Export Build | ⏸️ TODO | 2-3 hrs |
| **T05** | Embed Web UI in stigmer-server | ⏸️ TODO | 3-4 hrs |
| **T06** | CLI Integration & Polish | ⏸️ TODO | 2-3 hrs |
| **T07** | Build Pipeline & Dev Workflow | ⏸️ TODO | 2-3 hrs |

## T02: Migrate Web Source to Stigmer Repo

**Objective**: Move `client-apps/web/` from stigmer-cloud to stigmer, rewire dependencies.

**Deliverables**:
- `client-apps/web/` directory in stigmer with full Next.js 16 app
- `package.json` updated to reference local `@stigmer/protos` from `apis/stubs/ts/`
- Workspace configuration (npm/yarn/pnpm) for monorepo package resolution
- NextAuth/Auth0 hard dependency removed (auth becomes optional, handled in T03)
- `npm install && npm run dev` works against a running `stigmer server`

**Approach**:
- Copy source from stigmer-cloud, not move (stigmer-cloud can be cleaned up separately)
- Replace `"@stigmer/protos": "workspace:*"` with path reference to `../../apis/stubs/ts`
- Strip `next-auth`, `@auth/*` dependencies from `package.json`
- Remove `src/app/api/auth/[...nextauth]/route.ts`
- Simplify `Providers.tsx` to remove `SessionProvider`
- Keep all UI components, hooks, services, and pages intact

**Key decision**: The web app needs a workspace manager. Options:
- npm workspaces (simplest, built-in)
- pnpm workspaces (faster, stricter)
- Yarn workspaces (what stigmer-cloud uses)

Recommendation: npm workspaces — zero extra tooling, aligns with the "zero external dependencies" philosophy.

## T03: Implement Configurable Auth

**Objective**: Make authentication optional and provider-agnostic.

**Deliverables**:
- Auth mode runtime config: `disabled` (default for OSS local) or `oidc` (for cloud)
- `AuthGuard` component becomes a conditional wrapper — passthrough when auth disabled
- Transport interceptor conditionally injects `Authorization` header
- `OrgProvider` loads org from `/api/config` endpoint (local) or auth context (cloud)
- When auth is disabled, no login screen, no token exchange, no redirects

**Architecture**:
```
src/
  auth/
    auth-config.ts       — reads auth mode from runtime config
    AuthProvider.tsx      — conditional: NoopAuth or OIDCAuth
    useAuth.ts            — hook abstracting auth state
    oidc/                 — OIDC-specific implementation (lazy-loaded)
```

**Key principle**: Auth is a plugin. Components never import auth provider directly — they use `useAuth()` which returns `{ isAuthenticated, user, token }`. When auth is disabled, `isAuthenticated` is always `true` and `token` is `undefined`.

## T04: Configure Static Export Build

**Objective**: Produce a self-contained SPA that can be embedded in the Go binary.

**Deliverables**:
- `next.config.ts` with conditional `output: 'export'` for embedded builds
- `npm run build:embedded` script producing `out/` directory
- Client-side routing works for all dynamic routes (`/sessions/[id]`, `/agents/[id]`, etc.)
- Runtime config loaded from `/api/config` (a static JSON file in export mode, injected by the Go server)
- All pages verified in static export mode

**Approach**:
- `output: 'export'` disables API routes and middleware — acceptable since auth API routes are removed
- Dynamic routes use `generateStaticParams` or client-side-only rendering
- Environment variables baked at build time via `NEXT_PUBLIC_*` replaced with runtime config fetched from `/api/config`
- Build produces `out/` with `index.html`, JS bundles, and static assets

**Risk mitigation**: If any page is incompatible with static export, convert it to full client-side rendering with `'use client'` and dynamic imports.

## T05: Embed Web UI in stigmer-server

**Objective**: Serve the web console from the Go binary via `//go:embed`.

**Deliverables**:
- `client-apps/cli/embedded/webconsole/` — holds pre-built web assets (or build script populates it)
- `//go:embed` directive in a Go file adjacent to the assets
- HTTP handler in daemon serving the SPA on port 8234
- Catch-all fallback handler: any non-file request returns `index.html` (SPA routing)
- `GET /api/config` endpoint returns runtime JSON: `{ apiUrl, authMode, orgSlug }`
- Daemon lifecycle: web server starts with daemon, stops on shutdown

**Architecture**:
```go
// embedded/webconsole/embed.go
//go:embed all:out
var webConsoleFS embed.FS

// Served by daemon on port 8234
// Catch-all: if path matches a real file, serve it; otherwise serve index.html
```

**Port**: 8234, consistent with Temporal UI at 8233.

## T06: CLI Integration & Polish

**Objective**: Surface the web console URL in the CLI and add control flags.

**Deliverables**:
- `stigmer server` output updated:
  ```
  Ready! Stigmer server is running
    PID:  12345
    Port: 7234
    Data: ~/.stigmer

  Web UI:
    Console:   http://localhost:8234
    Temporal:  http://localhost:8233
  ```
- `--no-web` flag: disable web console (for headless/CI environments)
- `--web-port` flag: customize web console port (default 8234)
- Daemon health check includes web console component status
- JSON/quiet output formats include web console URL

## T07: Build Pipeline & Dev Workflow

**Objective**: Ensure the full build pipeline works end-to-end and document the dev workflow.

**Deliverables**:
- Root-level Makefile target: `make web` → builds web assets for embedding
- `make build-cli` depends on `make web` (assets must exist before Go compilation)
- Development workflow documented:
  - Web dev: `cd client-apps/web && npm run dev` (hot reload against `stigmer server`)
  - Full build: `make protos && make web && make build-cli`
- `.gitignore` updated for `client-apps/web/node_modules/`, `out/`, `.next/`
- CI considerations documented (Node.js + Go toolchain required)

---

## Review Process

**What happens next**:
1. **You review this plan** — consider the task breakdown, ordering, and approach
2. **Provide feedback** — concerns, changes, questions
3. **I'll revise** — create T01_2_revised_plan.md incorporating your feedback
4. **You approve** — explicit go-ahead to start T01
5. **Execution begins** — tracked in T01_3_execution.md

**Please consider**:
- Is the task ordering correct? (T01 → T02 → T03 → T04 → T05 → T06 → T07)
- Are the architectural choices sound? (static export, npm workspaces, auth-as-plugin)
- Any tasks missing or over-scoped?
- Any concerns about the embedding strategy or binary size?
- Should we handle CORS explicitly if API (7234) and web (8234) are different ports?
