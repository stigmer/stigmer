# Next Task: 20260322.01.documentation-infrastructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260322.01.documentation-infrastructure

**Description**: Build world-class documentation infrastructure for Stigmer: Vale prose linting, Fumadocs integration into the existing Next.js site, Snipsync code sample pipeline, auto-generated CLI/API reference docs, CI/CD quality gates, and advanced features (custom components, LLM output, search). Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories.
**Goal**: Transform Stigmer's ad-hoc 112 markdown files into a production-grade documentation system with automated quality enforcement, a rendered docs site at stigmer.ai/docs, tested code samples, and CI gates -- all within the existing monorepo
**Tech Stack**: Next.js 15, Fumadocs (fumadocs-core/fumadocs-mdx/fumadocs-ui), Vale, Snipsync, Prettier, Husky, MDX, Tailwind 4, TypeScript
**Components**: site/ (Next.js marketing site), docs/ (36 clean .mdx files + _archive), Makefile (build targets), .github/workflows/ (CI), root package.json (npm workspaces), sdk/ (Go/TS/Python/Java SDKs), client-apps/cli/ (CLI for doc generation), examples/ (code samples)

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
**Current Task**: T03 (Pre-commit Hooks) or T06 (Fumadocs Setup) — both unblocked
**Status**: In Progress — Phase 1 well advanced

## Session Progress (2026-03-22, Session 2)

### Completed
- **T05: Archive Existing Docs + Design Fresh Content Architecture**
  - Archived 116 legacy files to `docs/_archive/` (git history preserved)
  - Updated `.vale.ini` and `Makefile` to exclude archive from all tooling
  - Scaffolded 10-section content architecture (36 `.mdx` files)
  - Wrote 3 seed pages setting the quality bar: `index.mdx`, `installation.mdx`, `agents.mdx`
  - Validated: 0 Vale errors, 0 warnings, Prettier passes, archive excluded
  - Disabled 4 additional Vale rules due to domain term conflicts
  - Added 10 vocabulary entries to `accept.txt`

### Previously Completed (Session 1)
- **T01: Vale Prose Linter Setup** — `.vale.ini`, terms.yml, vocabulary, style packages
- **T02: Fix Broken Lint Target + Add Formatting** — Makefile targets, Prettier, lychee

## Next Steps

1. **T03: Pre-commit Hooks** — Husky + lint-staged for Vale/Prettier on staged docs files. Now safe since only clean content exists outside `_archive/`.
2. **T06: Fumadocs Setup** — Integrate Fumadocs into `site/`. The clean `.mdx` content structure is ready.
3. **T04: Style Guide and Contributing Guide** — Write `docs/STYLE.md` and `docs/CONTRIBUTING.md`

## Context for Resume
- The full 5-phase plan is in `tasks/T01_0_plan.md` (449 lines)
- Developer review feedback is in `tasks/T01_1_review.md`
- Session 1 checkpoint: `checkpoints/2026-03-22-session-1.md`
- Session 2 checkpoint: `checkpoints/2026-03-22-session-2.md`
- T05 execution plan: `.cursor/plans/t05_archive_and_content_architecture_8c635e0c.plan.md`
- Content architecture has 10 sections: getting-started, concepts, integration, sdks, architecture, deployment, cli, reference, contributing
- Seed pages set the voice: direct, technical, platform-builder audience, domain terms capitalized
- The `DOCS_SOURCES` Makefile variable uses `find` with `-path docs/_archive -prune` for exclusion

## Quick Commands

After loading context:
- "Continue with T03" — Pre-commit hooks (Husky + lint-staged)
- "Continue with T06" — Fumadocs setup
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
