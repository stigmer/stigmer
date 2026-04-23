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
**Current Task**: T01 — Workstreams A and C complete, Workstream B next
**Status**: In Progress

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

1. **Workstream B: Console Domain Organization** — The restructuring, verified against metrics from C
   - Create `src/domain/` with subdirectories
   - Move files incrementally, verify with `make lint && make check` after each batch

## Quick Commands

After loading context:
- "Start Workstream C" - Begin architectural metrics work
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review design decisions" - Check the 8 DDs and 5 dont-dos

---

*This file provides direct paths to all project resources for quick context loading.*
