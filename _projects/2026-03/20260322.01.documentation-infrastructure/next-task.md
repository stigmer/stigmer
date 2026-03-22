# Next Task: 20260322.01.documentation-infrastructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260322.01.documentation-infrastructure

**Description**: Build world-class documentation infrastructure for Stigmer: Vale prose linting, Fumadocs integration into the existing Next.js site, Snipsync code sample pipeline, auto-generated CLI/API reference docs, CI/CD quality gates, and advanced features (custom components, LLM output, search). Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories.
**Goal**: Transform Stigmer's ad-hoc 112 markdown files into a production-grade documentation system with automated quality enforcement, a rendered docs site at stigmer.ai/docs, tested code samples, and CI gates -- all within the existing monorepo
**Tech Stack**: Next.js 15.3.9, Fumadocs v15 (fumadocs-core 15.8.5, fumadocs-mdx 13.0.8, fumadocs-ui 15.8.5), Vale, Snipsync, Prettier, Husky, MDX, Tailwind 4, TypeScript, Orama (static search)
**Components**: site/ (Next.js marketing site + docs), docs/ (36 clean .mdx files + _archive + meta.json files), Makefile (build targets), .github/workflows/ (CI), root package.json (npm workspaces), sdk/ (Go/TS/Python/Java SDKs), client-apps/cli/ (CLI for doc generation), examples/ (code samples)

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
**Current Task**: Phase 1 complete. Next: Phase 3 (Snipsync) or Phase 4 (CI)
**Status**: Phase 1 COMPLETE, Phase 2 COMPLETE

## Session Progress (2026-03-22, Session 4)

### Completed
- **T03: Pre-commit Hooks** — Husky v9 + lint-staged for automated quality enforcement
  - Added `husky` (v9.1.7) and `lint-staged` (v16.4.0) to root `package.json`
  - `prepare` script auto-installs hooks on `npm install`
  - lint-staged runs Prettier on `docs/**/*.{md,mdx}` files
  - Pre-commit script runs Vale conditionally (graceful degradation if not installed)
  - Updated `Makefile` `setup` target with Husky initialization
  - Verified end-to-end: Prettier reformats, Vale catches violations, bad commits blocked

- **T04: Style Guide and Contributing Guide** — Documentation conventions formalized
  - Created `docs/STYLE.md` (~100 lines): audience, domain terms, headings, code blocks, prose, formatting
  - Created `docs/CONTRIBUTING.md` (~120 lines): prerequisites, workflow, content architecture, Make targets
  - Updated `.cursor/rules/stigmer-oss-documentation-standards.md` with canonical references
  - Both files pass Vale with zero errors/warnings
  - All 38 docs files pass `make lint-docs` and `make format-docs-check`

### Previously Completed
- **Session 3**: T06 — Fumadocs Integration (42 pages, 295KB search index)
- **Session 2**: T05 — Archive + Fresh Content Architecture (116 files archived, 36 MDX scaffolded)
- **Session 1**: T01 — Vale Prose Linter, T02 — Fix Broken Lint Target + Formatting

## Phase Completion Summary

### Phase 1: Quality Foundation — COMPLETE
- [x] T01: Vale Prose Linter Setup
- [x] T02: Fix Broken Lint Target + Formatting
- [x] T03: Pre-commit Hooks
- [x] T04: Style Guide and Contributing Guide
- [x] T05: Archive + Fresh Content Architecture

### Phase 2: Fumadocs Integration — COMPLETE
- [x] T06: Fumadocs Setup (includes T07 navigation, T08 Make targets, T09 search)

### Phase 3: Code Sample Pipeline — NOT STARTED
- [ ] T10: Snipsync Setup
- [ ] T11: Example Projects
- [ ] T12: CLI Reference Generation
- [ ] T13: Proto API Reference (experimental)

### Phase 4: CI/CD Pipeline — NOT STARTED
- [ ] T14: CI Quality Gates
- [ ] T15: PR Preview Deployments

### Phase 5: Advanced Features — NOT STARTED
- [ ] T16: Custom MDX Components
- [ ] T17: LLM-Friendly Output
- [ ] T18: On-Page Feedback
- [ ] T19: Visual Regression Testing

## Next Steps

1. **T14: CI Quality Gates** — GitHub Actions workflow for Vale/Prettier/build on docs PRs (no external dependencies, can start immediately)
2. **T10: Snipsync Setup** — Code sample extraction (requires `examples/` directory with working code)
3. **T12: CLI Reference Generation** — Auto-generated CLI docs from `stigmer --help`

## Context for Resume
- The full 5-phase plan is in `tasks/T01_0_plan.md` (449 lines)
- Developer review feedback is in `tasks/T01_1_review.md`
- Session 1 checkpoint: `checkpoints/2026-03-22-session-1.md`
- Session 2 checkpoint: `checkpoints/2026-03-22-session-2.md`
- Session 3 checkpoint: `checkpoints/2026-03-22-session-3.md`
- Session 4 checkpoint: `checkpoints/2026-03-22-session-4.md`
- T06 execution plan: `.cursor/plans/t06_fumadocs_setup_b1353cf0.plan.md`
- **Critical**: Node.js 22 is required. Node.js 23 silently breaks `next build` (webpack cache snapshot bug). `.nvmrc` is set.
- **Critical**: Dev server must use webpack, not Turbopack. `fumadocs-mdx` query-string imports (`?collection=docs`) are incompatible with Turbopack.
- Fumadocs v15 is compatible with Next.js 15.x and Tailwind 4. v16 requires Next.js 16/React 19.2+.
- Content architecture has 10 sections with `meta.json` controlling sidebar order
- Static Orama search uses `force-static` export with pre-built 295KB JSON index
- Pre-commit hooks: Husky v9 + lint-staged. Prettier always runs; Vale runs if installed.
- Style guide: `docs/STYLE.md`. Contributing guide: `docs/CONTRIBUTING.md`.

## Quick Commands

After loading context:
- "Continue with T14" — CI quality gates (GitHub Actions)
- "Continue with T10" — Snipsync setup (requires examples/)
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
