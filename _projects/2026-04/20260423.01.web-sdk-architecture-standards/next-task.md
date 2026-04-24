# Next Task: 20260423.01.web-sdk-architecture-standards

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260423.01.web-sdk-architecture-standards

**Description**: Codify stigmer web/SDK architectural standards inspired by planton refactoring practices -- document design decisions and dont-dos, reorganize the web console by domain to enforce SDK-first thin-shell discipline, and establish measurable architectural health metrics.
**Goal**: Establish formal design decisions for the SDK-first web architecture, restructure client-apps/web/src/ to mirror SDK domain modules with app/ as routes-only, and add ESLint rules and metrics to track architectural health quantitatively.
**Tech Stack**: TypeScript/React, Next.js, ESLint, @stigmer/react, @stigmer/sdk, @stigmer/theme
**Components**: client-apps/web/src (console), sdk/react (SDK domain modules), .cursor/rules (architecture rules), docs/ (design decisions)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260423.01.web-sdk-architecture-standards/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-23 11:14
**Current Task**: All workstreams + all follow-up items complete
**Status**: Complete (project finished)

## Session Progress (2026-04-23, Session 5)

### Follow-Up Tasks (All Complete)

Completed all three follow-up items identified at the end of Session 4:

**Phase 1 — Runner.ts codegen fix:**
- Fixed `sdk_client_ts.go` — added `!m.ClientStreaming` guard to prevent duplicate import
- Regenerated TS SDK; typecheck now passes cleanly

**Phase 2 — DD-002 route file thinning:**
- `app/library/layout.tsx`: 61 → 1 line (re-export from `domain/library/LibraryLayout.tsx`)
- `app/login/page.tsx`: 177 → 12 lines (Suspense wrapper, logic in `auth/login/LoginPageView.tsx`)
- `app/auth/github/callback/page.tsx`: 142 → 21 lines (Suspense wrapper, logic in `auth/github/GitHubCallbackPageView.tsx`)

**Phase 3 — Opacity modifier token remediation:**
- Added 8 new `--stgm-*` tokens with values for all 5 presets × light/dark (80 CSS values)
- Wired 5 existing + 8 new + sidebar tokens into SDK `@theme` bridge (was missing from `sdk/react/src/styles.css`)
- Replaced 328 class usages across 68 SDK files
- SDK lint: 0 `no-token-opacity-modifiers` warnings (down from 312)

**Metrics (final):**
- `next/*` imports in SDK: 0
- `@/` imports in SDK: 0
- Console imports of `@stigmer/react`: 31 files
- Opacity modifier warnings: 0 (down from 312)
- TS SDK typecheck: PASS (was FAIL)
- Web lint: 0 errors

**Checkpoint**: `checkpoints/2026-04-23-session-5.md`
**Changelog**: `_changelog/2026-04/2026-04-23-134002-codegen-fix-dd002-enforcement-opacity-token-remediation.md`

## Session Progress (2026-04-23, Session 4)

### Workstream B: Console Domain Organization (Complete)

Restructured `client-apps/web/src/` from feature-folder layout to domain-organized layout. The file tree now answers "which product area?" at a glance.

**Deliverables shipped:**
- `src/domain/_shared/layout/` — App shell, sidebars, org switcher, user menu (7 files)
- `src/domain/_shared/org/` — Org context, OrgGate (2 files)
- `src/domain/_shared/hooks/` — Cross-cutting Console hooks (2 files)
- `src/domain/_shared/ui/` — Console UI primitives (14 files)
- `src/domain/session/` — SessionPage, SessionLauncher, session-navigation, draft-session (4 files)
- `src/domain/settings/` — All settings section panels (11 files)
- `src/domain/library/` — Library pages, navigation, breadcrumb, with resource-type subdirs (10 files)
- `src/providers/` — Root provider composition (Providers.tsx, StigmerTransportBridge) (2 files)
- `src/domain/README.md` — Placement guide and decision tree for new code
- Deleted empty directories: `components/`, `contexts/`, `hooks/`, `utils/`

**Key structural changes:**
- `app/` is now routes only (page.tsx, layout.tsx, error.tsx) — no domain components
- Fixed the `AppShell → @/app/sessions/[id]/SessionPage` cross-boundary import smell
- `auth/` stays top-level (self-contained infrastructure, not a feature area)
- `config/` stays top-level (app infrastructure)
- Colocated library components (AgentListPage, LibraryLanding, etc.) moved from `app/library/` to `domain/library/`

**Metrics verification (no degradation):**
- `next/*` imports in SDK: 0 (unchanged)
- `@/` imports in SDK: 0 (unchanged)
- Console imports of `@stigmer/react`: 30 files, 34 lines (unchanged)
- Hook-to-component ratio: 1.11 (unchanged)
- Hardcoded colors: 3 in global-error.tsx (unchanged)
- Web lint: 0 errors (clean)
- Pre-existing issues remain: 312 opacity modifier warnings, runner.ts codegen bug

**Deferred items (DD-002 observations for future follow-up):**
- `app/login/page.tsx` contains auth flow orchestration logic
- `app/auth/github/callback/page.tsx` contains callback pipeline logic
- `app/library/layout.tsx` contains list/detail switching orchestration

## Session Progress (2026-04-23, Session 3)

### Workstream C: Architectural Metrics (Complete)

**Key finding**: The `sdk-import-boundaries` ESLint rule already existed in `eslint-plugin-stigmer` but was dormant — ESLint never visited SDK files because `npm run lint -w client-apps/web` only processes files under `client-apps/web/`. The actual deliverable shifted from "write a rule" to "wire the existing rule so it actually fires."

**Deliverables shipped:**
- `sdk/react/eslint.config.mjs` — Minimal ESLint 9 flat config with `@typescript-eslint/parser` and all three stigmer plugin rules (`sdk-import-boundaries` error, `no-token-opacity-modifiers` warn, `no-main-tokens-in-sidebar` warn)
- `sdk/react/package.json` — Added `eslint`, `@typescript-eslint/parser` devDependencies; added `lint` and `lint:fix` scripts
- Root `Makefile` — Added `verify-web` target (SDK react lint + typecheck, SDK typecheck, web lint); wired `@stigmer/react` lint and typecheck into `lint` and `fix` targets
- `checkpoints/baseline-metrics.md` — All five metrics documented with reproducible commands

**Baseline metrics:**
- `next/*` imports in SDK: 0 (target: 0) — enforced by ESLint
- `@/` imports in SDK: 0 (target: 0) — enforced by ESLint
- Console imports of `@stigmer/react`: 30 files, 34 lines
- Hook-to-component export ratio: 101/91 = 1.11 (target: >= 1.0)
- Hardcoded colors in Console: 3 (all in `global-error.tsx`, documented exception)
- Opacity modifier warnings in SDK: 312 (pre-existing, warn-level, remediation deferred)

**Bonus fix**: Removed a stray `@next/next/no-img-element` eslint-disable comment from `sdk/react/src/organization/OrgProfilePanel.tsx` — a Next.js artifact that had no business in an SDK file.

**Pre-existing issues surfaced:**
- `sdk/typescript/src/gen/runner.ts` has a codegen bug (duplicate `RunnerStreamServerMessage` import) that breaks both `@stigmer/sdk` and `@stigmer/react` typecheck. This predates Workstream C and requires regenerating proto stubs.
- `make lint` was already broken at the Go vet step (missing `mcp-server` package).

### Session 2: Codegen Bug Fix (unplanned, complete)
Discovered `make codegen` was broken — the `generateStreamingMethod` function in all four SDK generators (Go, TS, Python, Java) did not handle bidirectional streaming. The runner `Connect` RPC was being generated as server-streaming-only.

**Fixed across all generators:**
- **Go** (`sdk_client.go`): `Send`/`Recv`/`CloseSend` wrapper, `opts ...grpc.CallOption` signature
- **TypeScript** (`sdk_client_ts.go`): New `BidiStream<Send, Receive>` class with send/close/async iteration
- **Python** (`sdk_client_python.go`): New `BidiStream[Send, Receive]` class with queue-based send/iteration
- **Java** (`sdk_client_java.go`): New `StigmerBidiStream` class with async stub + `StreamObserver` bridging

**Commits**: `7ce4c852` (Go fix), `ce26866a` (TS/Python/Java fix)
**Changelog**: `_changelog/2026-04/2026-04-23-115929-fix-bidi-streaming-codegen-all-sdks.md`

### Session 1: Workstream A (Complete)
All deliverables shipped:
- 8 design decision files (DD-001 through DD-008) in `design-decisions/`
- 5 dont-do files (001 through 005) in `dont-dos/`
- 1 cursor rule: `.cursor/rules/client-apps/web/sdk-console-architecture.mdc`

The cursor rule incorporates the session preamble text that was previously pasted manually into chats. It auto-loads when editing files in `client-apps/web/src/` or `sdk/react/src/`.

### Key Decisions
- The chat preamble was formalized into the cursor rule rather than kept as a separate document
- Each DD file traces back to its source role file and mandate number
- The cursor rule was kept to 87 lines (well under the 150-line target)
- DD-005 cross-references `theme-token-guidelines.mdc` rather than duplicating token details

## Next Steps

Project is fully complete. All original workstreams and follow-up items are resolved:

- ~~DD-002 enforcement for thick route files~~ — Done (Session 5)
- ~~Opacity modifier remediation~~ — Done (Session 5)
- ~~Runner.ts codegen fix~~ — Done (Session 5)

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review design decisions" - Check the 8 DDs and 5 dont-dos

---

*This file provides direct paths to all project resources for quick context loading.*
