# Task T01: Documentation Infrastructure — Full Project Plan

**Created**: 2026-03-22
**Status**: PENDING REVIEW
**Type**: Feature Development (5 Phases)

> This plan requires your review before execution.

## Context

This plan is derived from a comparative analysis of six production documentation repositories:
- **Temporal** (Docusaurus, Vale, Snipsync) — primary reference for quality tooling
- **Pulumi** (Hugo, TypeDoc/Sphinx/DocFX/Javadoc) — primary reference for multi-language SDK docs
- **HashiCorp** (Next.js, unified docs API) — reference for multi-product architecture
- **GitHub** (Next.js, custom linter, Elasticsearch) — reference for CI/CD quality gates
- **Crossplane** (Hugo, Vale, CRD rendering) — reference for API docs from schemas
- **Next.js/Vercel** (Fumadocs) — reference for Fumadocs integration in a monorepo

The full analysis is preserved in the Cursor plan file at `.cursor/plans/documentation_strategy_analysis_cc17ff05.plan.md`.

## Current State (Stigmer)

- 112 `.md` files in `docs/` — AI-generated, no consistent quality, unknown staleness
- `make lint-docs` is broken — references missing `scripts/lint-docs.mjs`, lints `docs/**/*.mdx` (zero `.mdx` files exist)
- `site/` is a Next.js 15 marketing site (single landing page, 17 components, static export) — links to `/docs/*` but `site/public/docs/` is empty
- No prose linter, no code sample validation, no link checking, no pre-commit hooks, no search, no API doc generation
- `.cursor/rules/stigmer-oss-documentation-standards.md` defines good structure but has zero automated enforcement

## Architecture Decision: Next.js + Fumadocs

**Framework**: Fumadocs integrated into the existing `site/` directory.

**Rationale**:
- Next.js itself migrated its own docs to Fumadocs (`vercel/next.js/apps/docs/` uses `fumadocs-core@15.7.12`)
- Single framework — no second React runtime, no second build system
- `docs/` stays at repo root; `site/source.config.ts` points to `dir: '../docs'`
- `@stigmer/react` components can be used directly in MDX
- Fumadocs includes sidebar, TOC, search (Orama), breadcrumbs, OpenAPI integration
- One GitHub Pages deployment: landing at `/`, docs at `/docs/`

---

## Phase 1: Quality Foundation

**Goal**: Every markdown file passes automated quality checks before we build a site.
**Estimated effort**: 1-2 sessions.

### T01: Vale Prose Linter Setup

**Model**: Temporal `.vale.ini` + Crossplane vocabulary pattern.

**Deliverables**:
- `.vale.ini` at repo root
- `vale/styles/Stigmer/terms.yml` — domain term capitalization rules (Agent, Workflow, Skill, etc.)
- `vale/styles/Stigmer/vocabulary/accept.txt` — accepted terms (gRPC, proto, org, slug, spec, status, SDK, CLI, MCP, SQLite, Temporal, YAML, etc.)
- Style packages: Google, Microsoft, alex (same as Temporal)
- `make lint-docs` target — runs Vale on `docs/**/*.md`, fails on errors

**Key decisions**:
- MinAlertLevel: `warning` (not `suggestion` — too noisy for 112 existing files)
- Disable rules that conflict: `Microsoft.Contractions`, `Microsoft.Headings`, `Microsoft.Passive` (same as Temporal)
- `.vale.ini` treats `.mdx` as markdown (for future migration)

### T02: Fix Broken Lint Target + Add Formatting

**Deliverables**:
- Fix `make lint-docs` — change glob from `docs/**/*.mdx` to `docs/**/*.md`, remove reference to missing `scripts/lint-docs.mjs`
- Add `make lint-docs-audit` — non-blocking Vale run for triage
- Add `.prettierrc` for markdown formatting (model: Pulumi `.prettierrc.json`)
- Add `make format-docs` — runs Prettier on `docs/**/*.md`
- Add `make check-links` — runs `markdown-link-check` or Lychee on `docs/**/*.md`

### T03: Pre-commit Hooks

**Model**: Temporal Husky + lint-staged.

**Deliverables**:
- Add `husky` and `lint-staged` to root `package.json`
- Pre-commit: Vale on changed `docs/**/*.md`, Prettier on changed markdown
- `make setup` updated to include `husky install`

### T04: Style Guide and Contributing Guide

**Model**: Temporal `STYLE.md` + Pulumi `STYLE-GUIDE.md`.

**Deliverables**:
- `docs/STYLE.md` — Stigmer-specific writing conventions:
  - Capitalize Stigmer domain terms (Agent, Workflow, Skill, etc.)
  - Sentence casing for headings
  - Infinitive verb forms ("How to create an Agent" not "Creating an Agent")
  - Inclusive language (alex enforcement)
  - Code block language hints required
  - Mermaid diagrams encouraged for architecture
- `docs/CONTRIBUTING.md` — how to add/edit documentation:
  - Fork, branch, preview, PR workflow
  - Category placement guide (getting-started vs architecture vs guides etc.)
  - Vale and Prettier setup for local development
- Update `.cursor/rules/stigmer-oss-documentation-standards.md` to reference these files

### T05: Archive Existing Docs + Design Fresh Content Architecture

The existing 112 markdown files are AI-generated, stale, and not user-facing quality. We do not salvage them. We archive everything and start fresh.

**Audience**: Platform builders who will integrate Stigmer into their own products. Every page must answer: "Does a platform builder need this to understand or integrate Stigmer?"

**Deliverables**:
- Move entire `docs/` to `docs/_archive/` (preserved for internal reference, not rendered)
- Design a fresh content architecture oriented around the platform builder's journey:

  ```
  docs/
  ├── index.mdx                          # What is Stigmer? (30-second pitch for platform builders)
  ├── 01-getting-started/
  │   ├── index.mdx                      # Quick start overview
  │   ├── installation.mdx               # Install CLI, verify setup
  │   ├── first-agent.mdx                # Create and run your first agent (5 min)
  │   └── first-workflow.mdx             # Create and run your first workflow (10 min)
  ├── 02-concepts/
  │   ├── index.mdx                      # Core mental model
  │   ├── agents.mdx                     # What is an Agent? Lifecycle, spec/status
  │   ├── workflows.mdx                  # What is a Workflow? Tasks, execution
  │   ├── skills.mdx                     # What is a Skill? Versioning, artifacts
  │   ├── organizations.mdx              # Org/slug ownership model
  │   └── local-vs-cloud.mdx             # Backend modes, when to use which
  ├── 03-sdks/
  │   ├── index.mdx                      # SDK overview, language matrix
  │   ├── go/                            # Go SDK guide
  │   ├── typescript/                    # TypeScript SDK guide
  │   ├── python/                        # Python SDK guide
  │   └── java/                          # Java SDK guide
  ├── 04-cli/
  │   ├── index.mdx                      # CLI overview
  │   ├── commands/                      # Auto-generated CLI reference
  │   └── configuration.mdx              # Config, org context, precedence
  ├── 05-integration/
  │   ├── index.mdx                      # Embedding Stigmer in your platform
  │   ├── grpc-api.mdx                   # gRPC API guide for platform builders
  │   ├── react-components.mdx           # Using @stigmer/react in your app
  │   ├── theme-tokens.mdx               # Theming with --stgm-* tokens
  │   └── mcp-servers.mdx                # MCP server integration
  ├── 06-architecture/
  │   ├── index.mdx                      # System overview diagram
  │   ├── durable-execution.mdx          # Temporal-based durability guarantees
  │   ├── agent-lifecycle.mdx            # Agent execution phases
  │   ├── workflow-lifecycle.mdx         # Workflow execution phases
  │   └── open-core.mdx                  # OSS vs Cloud architecture
  ├── 07-deployment/
  │   ├── index.mdx                      # Deployment options overview
  │   ├── local-mode.mdx                 # Local development setup
  │   └── production.mdx                 # Production deployment guide
  ├── 08-reference/
  │   ├── index.mdx                      # Reference docs overview
  │   ├── api/                           # Auto-generated proto API reference
  │   └── configuration.mdx              # All config options
  └── 09-contributing/
      ├── index.mdx                      # How to contribute
      └── architecture-decisions.mdx     # ADR index and process
  ```

- Write seed content for the 3 most critical pages (these set the quality bar):
  1. `index.mdx` — What is Stigmer? Platform builder pitch.
  2. `01-getting-started/installation.mdx` — Install and verify.
  3. `02-concepts/agents.mdx` — Core concept explained for platform builders.
- These seed pages establish the voice, depth, and quality standard for all future docs.
- `docs/README.md` becomes a simple pointer to the rendered site, not an index.

---

## Phase 2: Fumadocs Integration

**Goal**: `docs/` renders as a navigable site at `stigmer.ai/docs/`.
**Estimated effort**: 2-3 sessions.

### T06: Fumadocs Setup

**Model**: `vercel/next.js/apps/docs/` (`source.config.ts`, `mdx-components.tsx`).

**Deliverables**:
- Add `fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui` to `site/package.json`
- Create `site/source.config.ts`:
  ```typescript
  import { defineConfig, defineDocs } from 'fumadocs-mdx/config'
  export const docs = defineDocs({ dir: '../docs' })
  export default defineConfig({ mdxOptions: {} })
  ```
- Update `site/next.config.ts` to include `createMDX()` from `fumadocs-mdx/next`
- Create `site/app/docs/layout.tsx` — docs layout with sidebar from `source.pageTree`
- Create `site/app/docs/[[...slug]]/page.tsx` — catch-all docs page
- Create `site/mdx-components.tsx` — MDX component mappings

### T07: Scaffold Fresh Content Structure + Seed Pages

The content structure is defined in T05. This task creates the actual files.

**Deliverables**:
- Create the directory structure from T05 with `meta.json` files for Fumadocs sidebar titles
- Write the 3 seed pages (from T05) at full quality — these set the bar:
  1. `docs/index.mdx` — "What is Stigmer?" for platform builders
  2. `docs/01-getting-started/installation.mdx` — install, verify, first command
  3. `docs/02-concepts/agents.mdx` — what an Agent is, why it matters, how it works
- Create placeholder `index.mdx` files for remaining sections (title + one-line description, "Coming soon")
- All files use `.mdx` extension from the start (Fumadocs native format)
- All files have proper frontmatter: `title`, `description`
- All seed pages pass Vale with zero errors

### T08: Make Targets and Local Dev

**Deliverables**:
- `make docs` — starts Fumadocs dev server with hot reload
- `make docs-build` — production build (integrated into `make check`)
- Update `site/Makefile` if needed
- Verify static export still works for GitHub Pages (`next build` with `output: 'export'`)

### T09: Search

**Model**: Fumadocs built-in Orama search (free, no external service).

**Deliverables**:
- Enable Fumadocs search in docs layout
- Verify search indexes all content correctly
- No Algolia yet — add later if built-in search is insufficient

---

## Phase 3: Code Sample Pipeline

**Goal**: Every code block in docs is extracted from a tested source.
**Estimated effort**: 2-3 sessions.

### T10: Snipsync Setup

**Model**: Temporal `snipsync.config.yaml`.

**Deliverables**:
- Add `snipsync` to root `package.json` devDependencies
- Create `snipsync.config.yaml`:
  ```yaml
  origins:
    - files:
        pattern: './examples/**/*.go'
    - files:
        pattern: './examples/**/*.ts'
    - files:
        pattern: './examples/**/*.py'
    - files:
        pattern: './examples/**/*.java'
    - files:
        pattern: './sdk/go/**/*.go'
    - files:
        pattern: './sdk/typescript/src/**/*.ts'
  targets:
    - docs
  features:
    enable_source_link: true
    enable_code_block: true
  ```
- Add `make snipsync` — runs Snipsync sync
- Add `make snipsync-check` — dry-run, fails if docs are out of sync

### T11: Example Projects

**Model**: Pulumi `static/programs/` pattern.

**Deliverables**:
- Create `examples/` directory structure:
  - `examples/getting-started-go/`
  - `examples/getting-started-typescript/`
  - `examples/getting-started-python/`
  - Per-SDK quickstart programs that are runnable and testable
- Add `SNIPSTART`/`SNIPEND` markers in example code
- Replace relevant inline code blocks in `docs/` with Snipsync markers

### T12: CLI Reference Generation

**Model**: Temporal `update-cli-docs.yml` + Pulumi `pulumi gen-markdown`.

**Deliverables**:
- Add `gen-docs` command to CLI (or script that parses `stigmer --help` tree)
- Generate markdown into `docs/03-cli/commands/` (auto-generated, gitignored or committed)
- Add `make gen-cli-docs` target
- GitHub Action to auto-PR when CLI commands change

### T13: Proto API Reference

**Model**: Crossplane CRD rendering (adapted for protobuf).

**Deliverables**:
- Script to generate reference docs from `.proto` files in `apis/`
- Output to `docs/09-references/api/` as MDX files
- Include: service name, RPC methods, request/response message fields, field descriptions from proto comments
- Add `make gen-api-docs` target
- This is experimental — no reference repo does this well. May need iteration.

---

## Phase 4: CI/CD Pipeline

**Goal**: No broken docs merge to main.
**Estimated effort**: 1-2 sessions.

### T14: CI Quality Gates

**Model**: Crossplane `vale.yml` + `link-checker.yml`.

**Deliverables**:
- `.github/workflows/docs-lint.yml`:
  - Trigger: PR touching `docs/**`
  - Steps: Vale lint on changed files, Prettier check, link check
- `.github/workflows/docs-build.yml`:
  - Trigger: PR touching `docs/**` or `site/**`
  - Steps: `make docs-build` (catches broken MDX, missing frontmatter)
- Add Snipsync check to CI (fail if docs are out of sync with examples)
- Integrate docs checks into existing `make check` target

### T15: PR Preview Deployments

**Model**: Temporal `docs-preview-links.yml`.

**Deliverables**:
- GitHub Action that builds docs and deploys preview on PR
- Comment on PR with preview URL for changed docs
- Options: Vercel (free for open source), Cloudflare Pages, or Netlify
- Evaluate which works best with GitHub Pages as the production deploy

---

## Phase 5: Advanced Features

**Goal**: World-class documentation experience.
**Estimated effort**: 2-3 sessions, can be spread over time.

### T16: Custom MDX Components

**Model**: Temporal components (ToolTipTerm, CaptionedImage) + Stigmer SDK-first philosophy.

**Deliverables**:
- `<SDKLanguageSwitcher>` — tabbed code blocks for Go/TS/Python/Java
- `<Callout>` variants — note, warning, tip, danger (Fumadocs includes base)
- `<ToolTipTerm>` — hover definitions for Stigmer domain terms (Agent, Workflow, Skill, etc.)
- Decision: build in `@stigmer/react` or in `site/src/components/docs/`?

### T17: LLM-Friendly Output

**Model**: Temporal `docusaurus-plugin-llms`.

**Deliverables**:
- Script or plugin to generate `llms.txt` and `llms-full.txt` from docs content
- Serve at `stigmer.ai/llms.txt`
- Integrates with Stigmer's existing MCP server

### T18: On-Page Feedback

**Model**: Temporal `docusaurus-pushfeedback` (lightweight).

**Deliverables**:
- "Was this page helpful?" widget on each docs page
- Data collection: page URL, yes/no, optional comment
- Storage: GitHub Issues, or a simple API endpoint

### T19: Visual Regression Testing

**Model**: Temporal `visual-comparison.yml` (defer until docs site is stable).

**Deliverables**:
- Playwright screenshot tests for key doc pages
- Weekly baseline capture
- Visual diff on PR with `visual-comparison` label

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Fumadocs integration conflicts with existing site/ layout/Tailwind | Medium | High | Spike T06 early; Fumadocs uses scoped styles |
| Fresh content takes longer than migrating existing docs | High | Medium | Start with 3 seed pages to set the bar; expand incrementally |
| Snipsync markers require example code to exist first | Medium | Low | T11 (examples) must precede Snipsync integration in docs |
| Proto-to-docs generation has no proven blueprint | High | Medium | T13 is experimental; may need multiple iterations |
| Static export (`output: 'export'`) breaks with Fumadocs | Low | High | Verify in T06; Fumadocs supports static export |

---

## Dependency Graph

```
Phase 1 (Quality)          Phase 2 (Site)           Phase 3 (Samples)      Phase 4 (CI)       Phase 5 (Advanced)
T01 Vale ──────────────┐
T02 Fix lint ──────────┤
T03 Pre-commit ────────┤── T06 Fumadocs ─────────── T10 Snipsync ────────── T14 CI gates ───── T16 Components
T04 Style guide ───────┤── T07 Navigation            T11 Examples            T15 PR previews    T17 LLM output
T05 Content audit ─────┘── T08 Make targets           T12 CLI docs                               T18 Feedback
                            T09 Search                 T13 API docs                               T19 Visual tests
```

Phase 1 is a prerequisite for Phase 2. Phases 3-5 can partially overlap. T13 (proto API docs) is independent and experimental.

---

## Success Criteria

Phase 1 complete when:
- [ ] `make lint-docs` runs Vale on all `docs/**/*.mdx` with zero errors
- [ ] `make format-docs` runs Prettier deterministically
- [ ] `make check-links` catches broken links
- [ ] Pre-commit hooks run Vale + Prettier on changed docs
- [ ] `docs/STYLE.md` and `docs/CONTRIBUTING.md` exist
- [ ] All 112 existing files archived to `docs/_archive/`
- [ ] Fresh content architecture designed and documented
- [ ] 3 seed pages written at full quality (index, installation, agents)

Phase 2 complete when:
- [ ] `make docs` starts a local docs dev server with sidebar and search
- [ ] `make docs-build` produces a static site deployable to GitHub Pages
- [ ] Seed pages and placeholder sections render correctly with navigation
- [ ] Docs accessible at `/docs/` alongside marketing landing page at `/`

Phase 3 complete when:
- [ ] `make snipsync` syncs code samples from `examples/` into docs
- [ ] At least one example project exists per SDK language (Go, TS, Python)
- [ ] `make gen-cli-docs` generates CLI reference from the Stigmer binary
- [ ] Proto API reference generation produces usable output (may be iterative)

Phase 4 complete when:
- [ ] CI blocks PR merge if Vale, build, or link checks fail
- [ ] PR preview deployments work for docs changes

Phase 5 complete when:
- [ ] Custom MDX components available for multi-language code blocks
- [ ] `llms.txt` served at site root
- [ ] Feedback mechanism on docs pages

---

## Review Process

**What happens next**:
1. You review this plan
2. Provide feedback — scope changes, priority adjustments, concerns
3. I create `T01_1_review.md` with your feedback
4. I create `T01_2_revised_plan.md` incorporating changes
5. You approve, and we begin execution starting with Phase 1 / T01

**Please consider**:
- Does the phasing make sense? Should anything move earlier or later?
- Is Fumadocs still the right call, or do you want to revisit?
- Any tasks that seem unnecessary or missing?
- Comfortable with the experimental nature of T13 (proto API docs)?
- How strictly should we enforce Vale on the existing 112 files? (Fix all vs. fix incrementally)
