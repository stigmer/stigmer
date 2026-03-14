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
| **T03** | Implement Configurable Auth | ⏸️ TODO |
| **T04** | Configure Static Export Build | ⏸️ TODO |
| **T05** | Embed Web UI in stigmer-server | ⏸️ TODO |
| **T06** | CLI Integration & Polish | ⏸️ TODO |
| **T07** | Build Pipeline & Dev Workflow | ⏸️ TODO |

## Key Architectural Decisions

- **Embedding**: Static export + `//go:embed` (zero Node.js runtime dependency)
- **Auth**: Optional, provider-agnostic (`disabled` for local, `oidc` for cloud)
- **Port**: 8234 for web console
- **Protos**: TypeScript codegen added to OSS (`apis/buf.gen.ts.yaml`)
- **Single codebase**: No separate web code in stigmer-cloud
- **Package manager**: npm workspaces (decided in T02)
- **Deployment artifacts**: Dockerfile and _kustomize/ kept in OSS (single codebase principle)

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

### Key Decisions Made
- npm workspaces chosen over Yarn/pnpm (zero extra tooling, built into Node.js)
- `@connectrpc/connect` NOT declared in `@stigmer/protos` package.json (matches stigmer-cloud pattern; relies on workspace hoisting)
- Auth stub approach: minimal no-ops in T02, proper configurable auth in T03
- Dockerfile and _kustomize/ included (single codebase principle — cloud deploys from OSS)

## Current Status

**Created**: 2026-03-14
**Current Task**: T03 (Implement Configurable Auth)
**Status**: T01 + T02 complete, T03 ready to start

## Next Steps

1. **T03**: Implement configurable auth — `useAuth()` hook, `AuthProvider`, runtime config (`disabled` | `oidc`)
2. **T04**: Configure static export build for Go embedding
3. **T05**: Embed web UI in stigmer-server via `//go:embed`

## Context for Resume
- Branch: `ref/migrate-web-to-oss`
- TypeScript codegen is fully working: `make ts-stubs` from `apis/` directory
- Web app is fully migrated and running: `npm run dev -w client-apps/web` starts on port 3000
- Auth is stubbed out (no-op) — T03 will implement configurable auth
- `@stigmer/protos` resolves via npm workspace symlink to `apis/stubs/ts/`
- App shell renders in browser (sidebar, navigation, dashboard cards)
- API calls fail at runtime (expected — no stigmer-server running)
- Pre-existing code quality issue noted: all service files use `any` cast for Connect-RPC clients

## Quick Commands

- "Continue with T03" — Start implementing configurable auth
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*Drag this file into any chat to resume work on this project.*
