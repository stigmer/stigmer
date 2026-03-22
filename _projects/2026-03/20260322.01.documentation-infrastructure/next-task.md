# Next Task: 20260322.01.documentation-infrastructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260322.01.documentation-infrastructure

**Description**: Build world-class documentation infrastructure for Stigmer: Vale prose linting, Fumadocs integration into the existing Next.js site, Snipsync code sample pipeline, auto-generated CLI/API reference docs, CI/CD quality gates, and advanced features (custom components, LLM output, search). Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories.
**Goal**: Transform Stigmer's ad-hoc 112 markdown files into a production-grade documentation system with automated quality enforcement, a rendered docs site at stigmer.ai/docs, tested code samples, and CI gates -- all within the existing monorepo
**Tech Stack**: Next.js 15, Fumadocs (fumadocs-core/fumadocs-mdx/fumadocs-ui), Vale, Snipsync, Prettier, Husky, MDX, Tailwind 4, TypeScript
**Components**: site/ (Next.js marketing site), docs/ (112 markdown files), Makefile (build targets), .github/workflows/ (CI), root package.json (npm workspaces), sdk/ (Go/TS/Python/Java SDKs), client-apps/cli/ (CLI for doc generation), examples/ (code samples)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260322.01.documentation-infrastructure/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-22 09:54
**Current Task**: T03 (Pre-commit Hooks) — next to pick up
**Status**: In Progress — Phase 1 underway

## Session Progress (2026-03-22)

### Completed
- **T01: Vale Prose Linter Setup** — `.vale.ini`, `vale/styles/Stigmer/terms.yml` (45 domain term rules), vocabulary files (accept.txt, reject.txt), style packages (Google, Microsoft, alex via `vale sync`)
- **T02: Fix Broken Lint Target + Add Formatting** — Replaced broken `make lint-docs` (was referencing missing `scripts/lint-docs.mjs` and `.mdx` glob). New targets: `lint-docs`, `lint-docs-audit`, `format-docs`, `format-docs-check`, `check-links`. Added Prettier and lychee. Removed `lint-docs` from `make check` temporarily.

### Key Decisions
- Vale packages downloaded via `vale sync`, not vendored — downloaded dirs gitignored
- `MinAlertLevel = warning` (not suggestion) — matches Temporal baseline
- `--no-progress` flag does not exist in Vale 3.14.1 — used `2>/dev/null` for sync output
- `lint-docs` removed from `make check` until T05 archives stale docs
- Lychee chosen over markdown-link-check for speed and simpler glob support

### Validation Results (existing 112 stale docs)
- Vale: 3,207 errors, 6,956 warnings (expected — these get archived in T05)
- Prettier: 112 files with formatting issues
- Lychee: 64 broken links

## Next Steps

1. **T03: Pre-commit Hooks** — BUT: should wait until after T05 (archive stale docs), otherwise hooks fire on 112 stale files. Consider doing T04 or T05 first.
2. **T04: Style Guide and Contributing Guide** — Write `docs/STYLE.md` and `docs/CONTRIBUTING.md`
3. **T05: Archive Existing Docs + Design Fresh Content Architecture** — Move `docs/` to `docs/_archive/`, design platform-builder-oriented structure, write 3 seed pages
4. **T06: Fumadocs Setup** — Depends on T05 for clean content structure

## Context for Resume
- The full 5-phase plan is in `tasks/T01_0_plan.md` (449 lines)
- Developer review feedback is in `tasks/T01_1_review.md`
- The Cursor plan file used for T01+T02 execution is at `.cursor/plans/vale_+_docs_tooling_a0726d14.plan.md`
- Temporal docs repo (`temporalio/documentation`) was the primary reference for Vale config
- Crossplane docs repo (`crossplane/docs`) was secondary reference (uses `utils/vale/` layout)

## Quick Commands

After loading context:
- "Continue with T03" - Pre-commit hooks (but consider T05 first)
- "Continue with T05" - Archive docs and design content architecture
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
