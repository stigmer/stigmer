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
**Current Task**: T02 (Create @stigmer/rpc-client)
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

## Task Plan Status

| Task | Title | Status |
|------|-------|--------|
| **T01** | Set up _libs directory structure and workspace config | **COMPLETED** |
| **T02** | Create @stigmer/rpc-client (infra layer) | PENDING |
| **T03** | Create @stigmer/theme (ui layer) | PENDING |
| **T04** | Create @stigmer/react-ui with execution module (domain layer) | PENDING |
| **T05** | Migrate Stigmer web console to consume @stigmer packages | PENDING |
| **T06** | Set up npm publishing (build tooling, CI) | PENDING |

## Next Steps

1. **T02**: Extract Connect-RPC transport, auth interceptor, and service client factory into `@stigmer/rpc-client`. Design the IoC bridge context (`StigmerClientConfig`) so the library doesn't depend on console auth.
2. **T03**: Extract `cn()` utility and CSS design tokens into `@stigmer/theme`. Decide how much of `globals.css` moves vs stays.
3. T02 and T03 are independent — they can be worked in parallel or either-first.

## Context for Resume

- The `_libs/` foundation is solid: workspace symlinks work, build passes, ESLint rule enforced
- The Planton reference implementation is at `/Users/suresh/scm/github.com/plantonhq/planton/client-apps/web/_libs/` — use it for IoC bridge patterns in T02
- Stigmer's current transport is a module-level singleton (`src/services/transport.ts`) with a module-level token store (`src/auth/token-store.ts`). T02 needs to decide whether to keep this pattern or move to React Context (Planton's approach). This is an architectural decision to collaborate on.
- The plan file is at `_projects/2026-03/20260315.01.web-libs-setup/tasks/T01_0_plan.md` — T02-T06 details are all there

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260315.01.web-libs-setup/checkpoints/2026-03-15-session-1.md
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
