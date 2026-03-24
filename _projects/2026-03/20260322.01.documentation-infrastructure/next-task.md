# Next Task: 20260322.01.documentation-infrastructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260322.01.documentation-infrastructure

**Description**: Build world-class documentation infrastructure for Stigmer: Vale prose linting, Fumadocs integration into the existing Next.js site, Snipsync code sample pipeline, auto-generated CLI/API reference docs, CI/CD quality gates, and advanced features (custom components, LLM output, search). Based on comparative analysis of Temporal, Pulumi, HashiCorp, GitHub, Crossplane, and Next.js documentation repositories.
**Goal**: Transform Stigmer's ad-hoc 112 markdown files into a production-grade documentation system with automated quality enforcement, a rendered docs site at stigmer.ai/docs, tested code samples, and CI gates -- all within the existing monorepo
**Tech Stack**: Next.js 15.3.9, Fumadocs v15 (fumadocs-core 15.8.5, fumadocs-mdx 13.0.8, fumadocs-ui 15.8.5), Vale, Snipsync, Prettier, Husky, MDX, Tailwind 4, TypeScript, Orama (static search), Mermaid.js (client-side diagrams)
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
**Current Task**: Session 12 complete. Next: T17 (LLM-Friendly Output), T10 (Snipsync), or T13 (Proto API Reference)
**Status**: Phase 1 COMPLETE, Phase 2 COMPLETE, Phase 3 PARTIALLY COMPLETE, Phase 4 PARTIALLY COMPLETE, Phase 5 PARTIALLY COMPLETE

## Session Progress (2026-03-24, Session 13 — stigmer-cloud IAM)

### Completed (stigmer-cloud, not docs-infrastructure)
- **IAM Bootstrap Automation**: Automated day-0 operator account creation
  - Migration now auto-creates `operator@stigmer.ai` in Auth0 via Management API
  - Eliminated `BOOTSTRAP_OPERATOR_IDP_ID` config, `BootstrapConfig` class, kustomize/Planton variables
  - Fixed all `.com` domain references to `.ai`
  - Deleted obsolete setup guides (developer-accounts, temporal-search-attributes, UPDATES_SUMMARY, scripts/)
  - Committed as `dd90398c` in stigmer-cloud

## Session Progress (2026-03-24, Session 12)

### Completed
- **T16: Custom MDX Components**
  - Added client-side Mermaid diagram rendering (`site/src/components/docs/mermaid.tsx`) with light/dark theme switching via MutationObserver
  - Created `remark-mermaid` plugin (`site/src/lib/remark-mermaid.ts`) that intercepts fenced mermaid code blocks before Shiki
  - Wired plugin into fumadocs-mdx via `source.config.ts` remarkPlugins
  - Enriched `installation.mdx` with Tabs (install methods, model providers), Steps, Callout, Term
  - Enriched `agents.mdx` with Term tooltips, Callout for blueprint/runtime invariant, Mermaid flowchart + stateDiagram
  - Updated STYLE.md with Cards/Card docs, success Callout type, accurate Mermaid section
  - Disabled `Google.Quotes`/`Microsoft.Quotes` Vale rules (systematic JSX false positives)
  - Build verified: 64 pages, zero errors, typecheck clean

### Previously Completed
- **Session 11**: Fix MDX angle-bracket escaping in gen-cli-docs
- **Session 9**: Docs home page redesign, "What is Stigmer?" relocation to concepts
- **Session 8**: Added breadcrumb navigation with home link
- **Session 7**: Fixed light/dark theme system (distinct palettes for both modes)
- **Session 6**: Docs navigation simplification, "What is Stigmer?" content rewrite
- **Session 5**: T14 — CI Quality Gates (first PR-triggered workflow in the repo)
- **Session 4**: T03 — Pre-commit Hooks, T04 — Style Guide + Contributing Guide
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

### Phase 3: Code Sample Pipeline — PARTIALLY COMPLETE
- [ ] T10: Snipsync Setup
- [ ] T11: Example Projects
- [x] T12: CLI Reference Generation
- [ ] T13: Proto API Reference (experimental)

### Phase 4: CI/CD Pipeline — PARTIALLY COMPLETE
- [x] T14: CI Quality Gates
- [ ] T15: PR Preview Deployments (deferred)

### Phase 5: Advanced Features — PARTIALLY COMPLETE
- [x] T16: Custom MDX Components
- [ ] T17: LLM-Friendly Output
- [ ] T18: On-Page Feedback
- [ ] T19: Visual Regression Testing

## Next Steps

1. **T17: LLM-Friendly Output** — `llms.txt` and structured sitemap for AI tool consumption
2. **T10: Snipsync Setup** — Code sample extraction (requires `examples/` directory with working code)
3. **T13: Proto API Reference** — Auto-generated proto API docs (experimental)
4. **Link checking improvements** — Add `.lychee.toml` config to handle Fumadocs-style links and exclude known flaky external URLs
5. **Content enrichment** — Apply MDX components to more content pages (SDKs, architecture, deployment)

## Context for Resume
- The full 5-phase plan is in `tasks/T01_0_plan.md` (449 lines)
- Developer review feedback is in `tasks/T01_1_review.md`
- Session 1 checkpoint: `checkpoints/2026-03-22-session-1.md`
- Session 2 checkpoint: `checkpoints/2026-03-22-session-2.md`
- Session 3 checkpoint: `checkpoints/2026-03-22-session-3.md`
- Session 4 checkpoint: `checkpoints/2026-03-22-session-4.md`
- Session 5 checkpoint: `checkpoints/2026-03-22-session-5.md`
- Session 6 checkpoint: `checkpoints/2026-03-22-session-6.md`
- Session 7 checkpoint: `checkpoints/2026-03-22-session-7.md`
- Session 8 checkpoint: `checkpoints/2026-03-22-session-8.md`
- Session 9 checkpoint: `checkpoints/2026-03-22-session-9.md`
- Session 10 checkpoint: `checkpoints/2026-03-22-session-10.md`
- Session 11 checkpoint: `checkpoints/2026-03-22-session-11.md`
- Session 12 checkpoint: `checkpoints/2026-03-24-session-12.md`
- T06 execution plan: `.cursor/plans/t06_fumadocs_setup_b1353cf0.plan.md`
- T12 execution plan: `.cursor/plans/t12_cli_reference_docs_85f99de8.plan.md`
- T14 execution plan: `.cursor/plans/t14_ci_quality_gates_6fe9edad.plan.md`
- T16 execution plan: `.cursor/plans/t16_custom_mdx_components_3d2006c8.plan.md`
- **Critical**: Node.js 22 is required. Node.js 23 silently breaks `next build` (webpack cache snapshot bug). `.nvmrc` is set.
- **Critical**: Dev server must use webpack, not Turbopack. `fumadocs-mdx` query-string imports (`?collection=docs`) are incompatible with Turbopack.
- **Critical**: New files in `site/src/lib/` require `git add -f` due to `lib/` pattern in `.gitignore` (Python build artifacts)
- Fumadocs v15 is compatible with Next.js 15.x and Tailwind 4. v16 requires Next.js 16/React 19.2+.
- Content architecture has 10 sections with `meta.json` controlling sidebar order
- Static Orama search uses `force-static` export with pre-built 295KB JSON index
- Pre-commit hooks: Husky v9 + lint-staged. Prettier always runs; Vale runs if installed.
- Style guide: `docs/STYLE.md`. Contributing guide: `docs/CONTRIBUTING.md`.
- CI workflow: `.github/workflows/ci.docs.yaml` (lint, build, links — first PR check in repo)
- Vale style packages are gitignored — `vale sync` is required in CI to download Google/Microsoft/alex
- `Google.Quotes` and `Microsoft.Quotes` Vale rules disabled (JSX false positives in MDX)
- Lychee link checking has known false positives: Fumadocs slug-style links (`./skills` vs `./skills.mdx`)
- Mermaid diagrams use client-side rendering via remark plugin + React component. Built-in `dark`/`default` themes.

## Quick Commands

After loading context:
- "Continue with T17" — LLM-friendly output (llms.txt)
- "Continue with T10" — Snipsync setup (requires examples/)
- "Continue with T13" — Proto API reference generation (experimental)
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

---

*This file provides direct paths to all project resources for quick context loading.*
