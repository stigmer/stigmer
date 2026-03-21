# Next Task: 20260321.01.documentation-foundation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.01.documentation-foundation

**Description**: Establish documentation standards, patterns, framework, linting rules, and cursor reminders for Stigmer developer documentation. Inspired by docs.temporal.io structure — quickstarts, SDK guides, concept docs — adapted for an agentic platform.
**Goal**: Set up a production-grade documentation system with framework (Fumadocs), content standards, linting, cursor rules/reminders, and initial quickstart structure that ensures all future documentation is consistent, high-quality, and maintainable.
**Tech Stack**: Next.js 15, Fumadocs (MDX), TypeScript, Markdown/MDX, ESLint custom rules, Tailwind CSS
**Components**: site (Next.js docs routes), docs/ (markdown content), .cursor/rules (documentation reminders), _roles/002_document_writer.md, @stigmer/theme (docs theming)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260321.01.documentation-foundation/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-03-21 10:49
**Current Task**: T01 — Phase 1 complete, Phase 2 next
**Status**: In Progress

## Session Progress (2026-03-21)

### Phase 1: Standards & Content Architecture — COMPLETE

Created 10 files under `docs/standards/`:

| File | Purpose |
|---|---|
| `documentation-standards.md` | Master standards: 5 mandates, content types, frontmatter schema, heading rules, code blocks, writing style, quality checklist |
| `information-architecture.md` | Sidebar tree, URL scheme, directory-to-route mapping, ordering conventions, landing page spec |
| `terminology.json` | 23 canonical terms with prohibited aliases, machine-readable for Phase 4 linter |
| `templates/concept.mdx` | Formalizes `what-is-*.md` pattern |
| `templates/quickstart.mdx` | 5-minute onboarding pattern |
| `templates/sdk-guide.mdx` | Language-specific topic guide |
| `templates/how-to-guide.mdx` | Task-oriented guide |
| `templates/cli-reference.mdx` | Man-page style command reference |
| `templates/architecture.mdx` | Design rationale document |
| `templates/adr.mdx` | Decision record |

### Bonus: Conversation Reminders

Created `_reminders/` folder with 4 files for dropping into Cursor conversations:

| File | When to use |
|---|---|
| `001_plan-first.md` | Every conversation |
| `002_collaboration-principles.md` | Every conversation |
| `003_platform-for-platforms.md` | UI/SDK/component work |
| `004_documentation-standards.md` | Documentation work |

### Key Decisions

- Design tokens use unprefixed semantic names (`--background`, `--primary`), not `--stgm-*` as the task plan assumed. Corrected in standards docs.
- `docs/standards/` directory is excluded from Fumadocs content sourcing — it holds governance docs, not rendered pages.
- Terminology dictionary covers 23 terms with exceptions for technical contexts (e.g., "org" permitted in CLI flags, "token" permitted for LLM tokens).

## Next Steps

1. **Phase 2: Framework Integration (Fumadocs + Next.js)** — Install packages, source config, docs layout, catch-all route, theme integration, static export, search
2. Phase 3: Cursor Rules & Reminders (can run parallel with 4/5 after Phase 2)
3. Phase 4: Documentation Linting
4. Phase 5: Quickstart Skeleton & Content Seeding

## Context for Resume

- Revised plan is in `tasks/T01_2_revised_plan.md` — all Phase 2 details are there.
- The site is a lean Next.js 15 app at `site/` with only 5 files in `src/app/`. Phase 2 adds the `docs/` route tree.
- Fumadocs `source.config.ts` will source from `../docs` (relative to `site/`).
- Static export (`output: "export"`) is confirmed compatible with Fumadocs.

## Quick Commands

After loading context:
- "Start Phase 2" — Begin framework integration
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
