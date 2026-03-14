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
| **T02** | Migrate Web Source to Stigmer Repo | ⏸️ TODO |
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

### Key Decision Made
- `@connectrpc/connect` NOT declared in `@stigmer/protos` package.json (matches stigmer-cloud pattern; will rely on workspace hoisting from consuming app in T02)

## Current Status

**Created**: 2026-03-14
**Current Task**: T02 (Migrate Web Source to Stigmer Repo)
**Status**: T01 complete, T02 ready to start

## Next Steps

1. **T02**: Copy `client-apps/web/` from stigmer-cloud, set up npm workspaces, rewire `@stigmer/protos` dependency, strip auth0/next-auth hard deps
2. **T03**: Implement configurable auth (disabled for local, oidc for cloud)
3. **T04**: Configure static export build for Go embedding

## Context for Resume
- Branch: `ref/migrate-web-to-oss`
- TypeScript codegen is fully working: `make ts-stubs` from `apis/` directory
- Generated stubs are committed to git (same convention as Go/Python stubs)
- stigmer-cloud web app reference: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud/client-apps/web/`
- stigmer-cloud uses Yarn workspaces; OSS plan recommends npm workspaces (decision to finalize in T02)

## Quick Commands

- "Continue with T02" — Start migrating the web source
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*Drag this file into any chat to resume work on this project.*
