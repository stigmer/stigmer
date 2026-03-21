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
**Current Task**: ALL PHASES COMPLETE
**Status**: Complete

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

### Phase 3: Cursor Rules & Reminders — COMPLETE

Created 3 Cursor rules and updated 2 existing files:

| Action | File | Purpose |
|---|---|---|
| Create | `.cursor/rules/docs/documentation-standards.mdc` | Auto-apply rule on `docs/**/*.{md,mdx}` — content-type detection, frontmatter, headings, terminology, writing style |
| Create | `.cursor/rules/docs/write-documentation.mdc` | Action rule — Doc Blueprint process, per-content-type template enforcement, Fumadocs patterns |
| Create | `.cursor/rules/docs/review-documentation.mdc` | Action rule — 25-item quality checklist, terminology audit, structural/link validation |
| Rewrite | `_roles/002_document_writer.md` | Removed duplicated standards (~60% was verbatim from `documentation-standards.md`), focused on persona/process/quality philosophy, added framework awareness |
| Update | `_reminders/004_documentation-standards.md` | Added cursor rules reference table, IA doc reference, tightened cross-references to use action rules |

### Phase 4: Documentation Linting — COMPLETE

Set up documentation linting with two tools:

| Action | File | Purpose |
|---|---|---|
| Create | `.markdownlint-cli2.jsonc` | Markdown structure/style linting config |
| Create | `scripts/lint-docs.mjs` | Custom linter: terminology, frontmatter, H1-title match, link validation |
| Modify | `package.json` | Added `markdownlint-cli2`, `gray-matter` devDeps |
| Modify | `Makefile` | Added `lint-docs`, `fix-docs`, `lint-docs-audit` targets; wired `lint-docs` into `check` |

Key design: `make lint-docs` strictly checks `docs/**/*.mdx` only (CI gate). `make lint-docs-audit` scans all `docs/**/*.{md,mdx}` non-blocking (content migration baseline — reports 377 issues across 114 legacy files). Terminology linter only flags multi-word prohibited terms to avoid false positives on generic programming words.

### Phase 5: Quickstart Skeleton & Content Seeding — COMPLETE

Populated the docs site with its first real content:

| Action | File | Purpose |
|---|---|---|
| Create | `docs/quickstarts/meta.json` | Sidebar ordering for quickstarts section |
| Create | `docs/quickstarts/index.mdx` | Section landing with CLI card (active), SDK cards ("Coming Soon") |
| Create | `docs/quickstarts/cli.mdx` | Agent-only CLI quickstart: install, create YAML, apply, run, verify |
| Create | `docs/concepts/stigmer.mdx` | "What is Stigmer?" migrated from `docs/product/what-is-stigmer.md` |
| Create | `docs/concepts/agent.mdx` | "What is an Agent?" migrated from `docs/product/what-is-agent.md` |
| Modify | `docs/meta.json` | Added `quickstarts` to sidebar before `concepts` |
| Modify | `docs/concepts/meta.json` | Added `stigmer`, `agent` to pages array |
| Modify | `docs/index.mdx` | Replaced minimal landing with hero + 6 section cards |
| Modify | `site/src/app/docs/[[...slug]]/page.tsx` | Added `Card`/`Cards` to MDX component mapping |

**Build results**: Static export succeeds — 12 pages generated. `make lint-docs` passes (6 files, 0 issues).

### Key Decisions

- **Node.js 20 LTS required** — Node 23 causes silent webpack crashes with Next.js 15.3.9. Must use Node 20 for all builds.
- **Turbopack disabled** — Can't resolve external `../docs/` files. Using webpack.
- **fumadocs-mdx v12** — v11 had API incompatibility with fumadocs-core v15. v12 required Next.js >=15.3.
- **`RootProvider` scoped to `/docs`** — Marketing page isolated from fumadocs.
- **Three rules, not five** — 1 auto-apply + 2 action rules. Content-type-specific logic consolidated into write rule via path detection, not fragmented per type.
- **Role as process, rules as enforcement** — Role file defines persona and behavior, cursor rules handle automated standards enforcement. Zero content duplication between role and standards doc.
- **Multi-word terminology enforcement only** — Single-word prohibited terms have broad contextual exceptions that a line-level linter cannot resolve. Automated linting flags multi-word terms only; single-word enforcement via Cursor rules.
- **MDX-only strict mode** — `make lint-docs` checks `.mdx` files only. Pre-existing `.md` files fixed by the content migration project. `make lint-docs-audit` provides the full audit.
- **MDX imports from external docs/ require component mapping** — MDX files outside `site/` cannot import from `site/node_modules/`. Fumadocs UI components (Card, Cards) are provided via the MDX component mapping in `page.tsx` instead of per-file imports.

## Project Complete

All 5 phases of the documentation foundation project are complete. The follow-up project is **Documentation Content Migration** — migrating ~54 public docs from `.md` to `.mdx`, triaging ~68 internal docs, fixing stale content, and applying the standards established here. See `tasks/T01_2_revised_plan.md` (lines 266-285) for the full scope.

## Context for Resume

- The site builds and exports successfully with Node.js 20. Use `nvm use 20` before running `yarn build`.
- Fumadocs is fully integrated: `source.config.ts` → `lib/source.ts` → docs layout/page.
- Marketing page at `/` is unaffected by fumadocs integration.
- Revised plan is in `tasks/T01_2_revised_plan.md` for Phase 2 details.
- The `docs/standards/` directory is excluded from Fumadocs content sourcing.
- Cursor rules live in `.cursor/rules/docs/`. Auto-apply rule triggers on any `docs/**/*.{md,mdx}` edit.
- Role file `_roles/002_document_writer.md` references standards docs, does not duplicate them.
- Doc linting: `make lint-docs` (strict MDX), `make lint-docs-audit` (all files), `make fix-docs` (auto-fix). Wired into `make check`.
- Custom linter at `scripts/lint-docs.mjs`. markdownlint config at `.markdownlint-cli2.jsonc`.
- Audit baseline: 377 issues across 114 legacy `.md` files (for content migration project).
- Fumadocs Card/Cards components available in MDX via component mapping in `page.tsx` — no imports needed in doc files.
- Static build generates 12 pages: landing, quickstarts index, CLI quickstart, concepts index, stigmer, agent, plus marketing pages.

## Quick Commands

After loading context:
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
