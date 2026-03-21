# Next Task: 20260321.01.documentation-foundation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.01.documentation-foundation

**Description**: Establish documentation standards, patterns, framework, linting rules, and cursor reminders for Stigmer developer documentation. Inspired by docs.temporal.io structure — quickstarts, SDK guides, concept docs — adapted for an agentic platform.
**Goal**: Set up a production-grade documentation system with framework (Fumadocs), content standards, linting, cursor rules/reminders, and initial quickstart structure that ensures all future documentation is consistent, high-quality, and maintainable.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Markdown/MDX, ESLint custom rules, Tailwind CSS v4
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
**Current Task**: Phase 2 complete, Phase 3 next
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

### Phase 2: Fumadocs Framework Integration — COMPLETE

Installed and configured Fumadocs within the existing Next.js site:

| Action | File | Purpose |
|---|---|---|
| Install | `fumadocs-mdx@12.0.3`, `fumadocs-core@15.8.5`, `fumadocs-ui@15.8.5` | Framework packages |
| Upgrade | `next@15.3.9`, `react@19.1.0` | Required by fumadocs-mdx v12 |
| Create | `site/source.config.ts` | Content sourcing from `../docs`, excludes `standards/` |
| Create | `site/src/lib/source.ts` | Runtime source loader |
| Create | `site/src/app/docs/layout.tsx` | Docs layout with `RootProvider` + `DocsLayout` |
| Create | `site/src/app/docs/[[...slug]]/page.tsx` | MDX renderer + `generateStaticParams` |
| Create | `docs/index.mdx`, `docs/meta.json` | Docs landing page + sidebar ordering |
| Create | `docs/concepts/index.mdx`, `docs/concepts/meta.json` | Test page for nested routing |
| Modify | `site/next.config.ts` | `createMDX()` wrapper + `outputFileTracingRoot` |
| Modify | `site/tsconfig.json` | `@/.source` path alias for generated files |
| Modify | `site/src/app/globals.css` | Fumadocs CSS imports |
| Modify | `site/src/app/layout.tsx` | `suppressHydrationWarning` |
| Fix | `site/src/components/sections/Hero.tsx` | `<a>` → `<Link>` for internal docs links |
| Fix | `site/src/components/sections/Quickstart.tsx` | `<a>` → `<Link>` for internal docs links |
| Fix | `site/src/components/ui/code-block.tsx` | `@ts-expect-error` for React 19 type compat |

**Build results**: Static export succeeds — 8 pages generated, `/docs` and `/docs/concepts` both SSG'd.

### Key Decisions

- **Node.js 20 LTS required** — Node 23 causes silent webpack crashes with Next.js 15.3.9. Must use Node 20 for all builds.
- **Turbopack disabled** — Can't resolve external `../docs/` files. Using webpack.
- **fumadocs-mdx v12** — v11 had API incompatibility with fumadocs-core v15. v12 required Next.js >=15.3.
- **`RootProvider` scoped to `/docs`** — Marketing page isolated from fumadocs.

## Next Steps

1. **Phase 3: Cursor Rules & Reminders** — Documentation workflow rules for Cursor
2. **Phase 4: Documentation Linting** — Terminology enforcement, frontmatter validation
3. **Phase 5: Quickstart Skeleton & Content Seeding** — Initial content population

## Context for Resume

- The site builds and exports successfully with Node.js 20. Use `nvm use 20` before running `yarn build`.
- Fumadocs is fully integrated: `source.config.ts` → `lib/source.ts` → docs layout/page.
- Marketing page at `/` is unaffected by fumadocs integration.
- Revised plan is in `tasks/T01_2_revised_plan.md` for Phase 2 details.
- The `docs/standards/` directory is excluded from Fumadocs content sourcing.

## Quick Commands

After loading context:
- "Start Phase 3" — Begin cursor rules & reminders
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
