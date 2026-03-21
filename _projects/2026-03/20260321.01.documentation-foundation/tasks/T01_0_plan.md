# Task T01: Documentation Foundation — Standards, Framework, and Patterns

**Created**: 2026-03-21
**Status**: Planning (pending review)

## Overview

This project establishes the entire documentation system for Stigmer — the standards, patterns, framework, linting, and cursor reminders that ensure every piece of documentation produced (by human or AI) is consistent, high-quality, and maintainable. The deliverables are **not documentation content** but the **infrastructure and rules** that govern how content is written, structured, validated, and published.

Inspired by [docs.temporal.io](https://docs.temporal.io/) (which uses Docusaurus), but adapted for Stigmer's Next.js-based site and "platform for platforms" philosophy.

---

## Research Findings

### What Temporal Does (docs.temporal.io)

Temporal's documentation is a Docusaurus site with:

| Element | Description |
|---------|-------------|
| **Home** | Hero with tagline ("Build applications that never fail"), SDK icons, quick-link cards (Quickstart, Developer Guide, Deploy, Get Started Free) |
| **Quickstarts** | Per-SDK quickstart pages (Go, Java, PHP, Python, Ruby, TypeScript, .NET) |
| **Develop** | SDK-specific developer guides organized by topic (Core Application, Temporal Client, Activities, Workflows, Testing, Failure Detection, Messages, Versioning, Observability, etc.) |
| **Evaluate** | Use cases, why Temporal |
| **Temporal Cloud** | Cloud-specific docs |
| **References** | API references, configuration |
| **Sidebar** | Left sidebar with collapsible tree navigation |
| **TOC** | Right sidebar with on-page table of contents |
| **Copy for LLM** | Button to copy page content in LLM-friendly format |
| **Search** | Full-text search with AI assist |

### Stigmer's Current State

| Area | Status |
|------|--------|
| **Site framework** | Next.js 15 (App Router), `output: "export"` for GitHub Pages |
| **Docs content** | 116 markdown files in `docs/` — product concepts, architecture, guides, CLI, SDK, ADRs |
| **Docs routing** | None — `/docs` link in header goes to a non-existent route |
| **Docs framework** | None — `public/docs/.gitkeep` placeholder only |
| **Content templates** | `what-is-*.md` pattern for concept docs (5-section structure) |
| **Roles** | 6 roles defined, including Document Writer (`002_document_writer.md`) |
| **Linting** | ESLint for code, no documentation linting |
| **Cursor rules** | Commit, PR, proto-doc rules — no doc-content rules |

### Framework Selection: Why Fumadocs

Since the site is already Next.js 15 (App Router), the framework must be Next.js-native. Options evaluated:

| Framework | Fit | Reason |
|-----------|-----|--------|
| **Docusaurus** | Poor | Separate build system, not Next.js-native. Would require a second site or major architectural change. |
| **Nextra v4** | Good | Mature, App Router support, but more opinionated — harder to align with `--stgm-*` token system. |
| **Fumadocs** | Best | Native Next.js App Router, headless component API, modular packages (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`), customizable search (Orama), themeable. Aligns with Stigmer's platform-for-platforms philosophy — headless-first, composable. |
| **Starlight** | Poor | Astro-based, not Next.js. |
| **VitePress** | Poor | Vue-based, not React/Next.js. |

**Recommendation**: Fumadocs, with its UI components themed to use `--stgm-*` design tokens so the docs site feels native to the Stigmer brand.

> **Decision point for review**: Is Fumadocs the right choice? This is the most consequential technical decision in the project. Alternatives exist — we could also keep things simpler with a custom MDX setup without a framework, though we'd lose search, sidebar generation, and breadcrumbs.

---

## Architecture

### Information Architecture (Modeled after Temporal, Adapted for Stigmer)

```
docs.stigmer.dev (or stigmer.dev/docs)
│
├── Home (Docs Landing)
│   ├── Hero: "Build Agents. Skip the Infrastructure." (or refined tagline)
│   ├── Quick-link cards: Quickstart, Developer Guide, Deploy, CLI Reference
│   └── SDK/Integration icons: Go SDK, TypeScript SDK, Python SDK, CLI, gRPC API
│
├── Quickstarts                          ← The "deal breaker" (your words)
│   ├── Overview (choose your path)
│   ├── CLI Quickstart                   ← Install stigmer, create agent, run it
│   ├── Go SDK Quickstart                ← Hello world with Go SDK
│   ├── TypeScript SDK Quickstart        ← Hello world with TS SDK
│   └── Python SDK Quickstart            ← Hello world with Python SDK
│
├── Concepts                             ← "What is X?" docs (existing what-is-*.md)
│   ├── What is Stigmer?
│   ├── What is an Agent?
│   ├── What is a Skill?
│   ├── What is a Session?
│   ├── What is a Workflow?
│   ├── What is an MCP Server?
│   ├── What is an Organization?
│   └── ...
│
├── Develop (SDK Guides)                 ← Temporal's "Develop" section
│   ├── Go SDK
│   │   ├── Setup
│   │   ├── Creating Agents
│   │   ├── Creating Skills
│   │   ├── Creating Workflows
│   │   ├── Running Executions
│   │   └── ...
│   ├── TypeScript SDK
│   │   ├── Setup
│   │   ├── React Components
│   │   ├── Hooks Reference
│   │   └── ...
│   ├── Python SDK
│   │   └── ...
│   └── gRPC API
│       ├── Proto Reference
│       └── Direct Integration
│
├── Guides                               ← How-to guides (existing guides/)
│   ├── Environment Variables
│   ├── Using MCP Servers
│   ├── Deploying with Apply
│   ├── Durable Execution
│   └── ...
│
├── CLI Reference                        ← CLI command reference
│   ├── stigmer new
│   ├── stigmer run
│   ├── stigmer apply
│   └── ...
│
├── Architecture                         ← Deep dives (existing architecture/)
│   ├── Backend Modes
│   ├── Temporal Integration
│   ├── Skill Versioning
│   └── ...
│
└── Changelog
```

### Routing Structure (in Next.js App Router)

```
site/
├── src/app/
│   ├── docs/                            ← New: docs routes
│   │   ├── layout.tsx                   ← Docs layout with sidebar + TOC
│   │   ├── page.tsx                     ← Docs home/landing
│   │   └── [[...slug]]/                 ← Catch-all for MDX pages
│   │       └── page.tsx                 ← Dynamic MDX renderer
│   └── ...existing routes
├── content/                             ← New: MDX content directory
│   └── docs/                            ← Fumadocs content source
│       ├── index.mdx                    ← Docs landing
│       ├── quickstarts/
│       │   ├── index.mdx
│       │   ├── cli.mdx
│       │   ├── go-sdk.mdx
│       │   └── ...
│       ├── concepts/
│       │   ├── agent.mdx
│       │   ├── skill.mdx
│       │   └── ...
│       └── ...
└── source.config.ts                     ← Fumadocs content source config
```

### Theme Integration

The docs site will use the existing `--stgm-*` design token system:

- Docs sidebar → uses `--stgm-sidebar-*` tokens
- Docs content area → uses `--stgm-*` main tokens
- Code blocks → uses `--stgm-code-*` tokens (may need new tokens)
- Fumadocs components are overridden/themed via CSS to consume `--stgm-*` tokens
- The `.stgm` container scope and `@layer stgm` isolation rules apply

---

## Scope

### In Scope (This Project Delivers)

1. **Documentation Framework Setup** — Fumadocs integrated into the Next.js site with routing, sidebar, search, breadcrumbs, and TOC
2. **Content Standards Document** — A comprehensive standards doc defining templates, writing style, structure, terminology, and examples for every doc type
3. **Doc Type Templates** — Concrete MDX templates for: Concept doc, Quickstart, SDK Guide, How-to Guide, CLI Reference, Architecture Doc, ADR, Changelog entry
4. **Cursor Rules/Reminders** — `.cursor/rules/` files that enforce documentation standards in every AI conversation that touches docs
5. **Documentation Linting** — Custom lint rules (ESLint or dedicated markdown linter) that validate: heading hierarchy, terminology consistency, template compliance, link validity, code block formatting
6. **Information Architecture** — The sidebar structure, navigation hierarchy, and URL scheme for the docs site
7. **Docs Landing Page** — The `/docs` page that users see when they click "Docs" in the header (modeled after Temporal's docs home)
8. **Quickstart Skeleton** — The structure and template for the CLI Quickstart (the "deal breaker" page) — content is a placeholder or thin first draft, not full content
9. **Migration Strategy** — A documented plan for migrating existing `docs/` markdown files into the new framework (not the migration itself)
10. **Role Update** — Updated `002_document_writer.md` to reference new standards, templates, and linting
11. **Existing Homepage Integration** — The site header `/docs` link routes to the new docs landing

### Out of Scope (Future Work)

- Full content authoring for all 116 existing docs
- Actual migration of existing markdown files to MDX
- SDK-specific quickstart content (Go, TS, Python)
- API reference auto-generation from protos
- Versioned documentation
- Internationalization (i18n)
- Full-text search deployment (Algolia, Orama cloud)
- "Copy for LLM" button (nice-to-have, defer)
- Blog/changelog section

---

## Phases

### Phase 1: Standards & Content Architecture (No Code)

**Goal**: Define what "good documentation" means for Stigmer before writing any framework code.

**Deliverables**:

1. **Documentation Standards Document** (`docs/standards/documentation-standards.md`)
   - Writing style guide (voice, tone, tense, terminology)
   - Ubiquitous language glossary (Agent, AgentExecution, Skill, McpServer, etc. — canonical forms, prohibited aliases)
   - Content types taxonomy with purpose and audience for each:
     - **Concept** — "What is X?" (existing `what-is-*.md` pattern)
     - **Quickstart** — "Get X running in 5 minutes"
     - **SDK Guide** — "How to use X with SDK Y"
     - **How-to Guide** — "How to accomplish task Z"
     - **CLI Reference** — "Command reference for `stigmer <cmd>`"
     - **Architecture** — "Why X is designed this way"
     - **ADR** — "We decided X because Y"
     - **Changelog** — "What changed in version N"
   - Heading hierarchy rules (H1 = page title, H2 = major sections, H3 = subsections, never skip levels)
   - Code block rules (language tags required, complete runnable examples preferred, test all examples)
   - Frontmatter schema (title, description, sidebar_position, tags, last_updated, author)
   - Cross-referencing rules (relative links, canonical paths, no duplicated explanations)
   - Image/diagram guidelines (when to use, format, alt text requirements)

2. **Doc Type Templates** (one MDX template per content type in `docs/standards/templates/`)
   - Each template includes: required frontmatter, section structure, example content, comments explaining what goes where
   - Templates are the "pattern" that makes AI-generated docs consistent

3. **Information Architecture Map** (the sidebar tree, URL scheme, content organization)
   - Modeled after Temporal's structure but adapted for Stigmer's domain
   - Defines the canonical URL for every content category
   - Defines sidebar ordering and grouping

4. **Terminology Lint Dictionary** (`docs/standards/terminology.json`)
   - Machine-readable dictionary mapping prohibited terms to required terms
   - Example: `"agent run" → "AgentExecution"`, `"tool connector" → "McpServer"`, `"job" → "AgentExecution"`

**Validation**: Review with developer before proceeding to framework integration.

---

### Phase 2: Framework Integration (Fumadocs + Next.js)

**Goal**: Wire Fumadocs into the existing Next.js site so that `/docs` renders documentation with sidebar navigation, breadcrumbs, and table of contents.

**Deliverables**:

1. **Install Fumadocs packages**
   - `fumadocs-core` — routing, breadcrumbs, search utilities
   - `fumadocs-ui` — pre-built layout components (sidebar, TOC, search dialog)
   - `fumadocs-mdx` — MDX content source with frontmatter support

2. **Source configuration** (`source.config.ts`)
   - Point content source to `content/docs/` directory
   - Configure frontmatter schema
   - Set up content collections

3. **Docs layout** (`site/src/app/docs/layout.tsx`)
   - Left sidebar with collapsible tree navigation
   - Right sidebar with on-page TOC
   - Responsive: sidebar collapses on mobile
   - Themed with `--stgm-*` tokens (not Fumadocs default theme)

4. **Docs catch-all route** (`site/src/app/docs/[[...slug]]/page.tsx`)
   - Dynamic MDX page renderer
   - Generates static pages for `output: "export"` compatibility
   - Breadcrumb integration

5. **Docs landing page** (`content/docs/index.mdx`)
   - Hero section: tagline, description
   - Quick-link cards (Quickstart, Developer Guide, CLI, API)
   - Modeled after Temporal's docs home

6. **Theme override layer**
   - Override Fumadocs CSS variables to map to `--stgm-*` tokens
   - Ensure docs pages match the site's dark theme and design language
   - Code block syntax highlighting that matches the site aesthetic

7. **Static export compatibility**
   - Verify `output: "export"` works with Fumadocs
   - Generate `generateStaticParams()` for all MDX pages
   - Test build with `yarn build`

8. **Navigation integration**
   - Update site header to link to `/docs` (already links, just needs working route)
   - Ensure back navigation from docs to main site works

**Technical risk**: Fumadocs `output: "export"` compatibility. If static export has issues, fallback is a custom MDX setup using `next-mdx-remote` with manual sidebar generation. This is more work but guaranteed to work with static export.

> **Decision point for review**: If Fumadocs has static export issues, should we (a) switch to Nextra, (b) build a custom MDX pipeline, or (c) drop `output: "export"` and deploy differently?

---

### Phase 3: Cursor Rules & Reminders

**Goal**: Create cursor rules that inject documentation standards into every AI conversation that creates or edits documentation content.

**Deliverables**:

1. **Documentation Content Rule** (`.cursor/rules/docs/write-documentation.mdc`)
   - Triggered when editing files in `content/docs/` or `docs/`
   - Injects: writing style rules, terminology glossary, template structure for the detected doc type, frontmatter requirements
   - Enforces: active voice, ubiquitous language, no assumptions, complete examples

2. **Documentation Review Rule** (`.cursor/rules/docs/review-documentation.mdc`)
   - Action rule invoked as `@review-documentation`
   - Runs a checklist against the current doc: terminology compliance, heading hierarchy, code block completeness, frontmatter validity, cross-reference integrity
   - Outputs a structured review with pass/fail per criterion

3. **Quickstart Authoring Rule** (`.cursor/rules/docs/write-quickstart.mdc`)
   - Specialized rule for quickstart content
   - Enforces: 5-minute completion target, complete runnable code, prerequisite list, verification steps
   - Template injection for quickstart structure

4. **SDK Guide Authoring Rule** (`.cursor/rules/docs/write-sdk-guide.mdc`)
   - Specialized rule for SDK guide content
   - Enforces: code examples in the target SDK language, API reference links, import statements, error handling examples

5. **Updated Document Writer Role** (`_roles/002_document_writer.md`)
   - Reference new standards document
   - Reference new templates
   - Reference new cursor rules
   - Integrate with linting workflow

**Format**: Each rule follows the existing `.mdc` pattern with `description`, `globs`, and `alwaysApply` frontmatter.

---

### Phase 4: Documentation Linting

**Goal**: Automated validation that documentation meets standards — runnable in CI, usable locally, integrated with `make check`.

**Deliverables**:

1. **Markdown Linting** (via `markdownlint-cli2` or similar)
   - Heading hierarchy (no skipped levels)
   - No trailing whitespace
   - Consistent list markers
   - Fenced code blocks must have language tags
   - No bare URLs
   - Frontmatter required
   - Custom rules for Stigmer-specific patterns

2. **Terminology Linter** (custom script or ESLint rule)
   - Reads `docs/standards/terminology.json`
   - Scans MDX/MD files for prohibited terms
   - Reports violations with suggested replacements
   - Example: `"agent run" found on line 42 — use "AgentExecution" instead`

3. **Link Validation**
   - Internal link checker (all relative links resolve to real files)
   - Anchor link validation (heading anchors exist)
   - External link validation (optional, separate CI step)

4. **Frontmatter Validation**
   - Required fields present (title, description)
   - Optional fields have correct types
   - `sidebar_position` values are unique within a directory

5. **CI Integration**
   - `make lint-docs` command
   - Runs markdown lint + terminology lint + link validation
   - Integrated into `make check` pipeline
   - GitHub Actions step (future — out of scope for this project but the commands must work locally)

6. **Makefile target**
   - `make lint-docs` — run all documentation linters
   - `make fix-docs` — auto-fix what can be auto-fixed (trailing whitespace, list markers)

---

### Phase 5: Quickstart Skeleton & Content Seeding

**Goal**: Prove the system works end-to-end by creating the quickstart skeleton and seeding minimal content.

**Deliverables**:

1. **CLI Quickstart page** (`content/docs/quickstarts/cli.mdx`)
   - The "deal breaker" page — modeled after Temporal's Go SDK Quickstart
   - Sections: Prerequisites, Install Stigmer CLI, Start the Server, Create Your First Agent, Run the Agent, Verify It Works, Next Steps
   - Uses the quickstart template from Phase 1
   - Content is a thin first draft (not polished marketing copy)

2. **Concepts index** (`content/docs/concepts/index.mdx`)
   - Landing page for concept docs
   - Links to existing `what-is-*.md` content (migrated or referenced)

3. **2-3 migrated concept docs** (proof of migration)
   - `what-is-stigmer.md` → `content/docs/concepts/stigmer.mdx`
   - `what-is-agent.md` → `content/docs/concepts/agent.mdx`
   - Demonstrates the migration pattern (frontmatter additions, MDX conversion, sidebar integration)

4. **Quickstart index** (`content/docs/quickstarts/index.mdx`)
   - Overview page listing available quickstarts
   - Cards for CLI, Go SDK, TypeScript SDK, Python SDK (only CLI has content; others are "Coming Soon")

5. **Docs landing page content** (`content/docs/index.mdx`)
   - Polished landing with: tagline, description, 4 quick-link cards, SDK/integration icons
   - This is the page users see at `/docs`

**Validation**: Build the site (`yarn build`), verify all docs pages render correctly, run `make lint-docs`, verify sidebar navigation works.

---

## Existing Infrastructure to Leverage

| Component | Location | Relevance |
|-----------|----------|-----------|
| 116 markdown docs | `docs/` | Content to be migrated (future) — informs IA now |
| `what-is-*.md` template | `docs/product/` | Existing concept doc pattern — standardize and formalize |
| Document Writer role | `_roles/002_document_writer.md` | Existing guidance — update to reference new standards |
| Site design tokens | `site/src/app/globals.css` | `--stgm-*` tokens for theming docs |
| Site header | `site/src/components/layout/Header.tsx` | Already links to `/docs` |
| Hero section | `site/src/components/sections/Hero.tsx` | "Build Agents. Skip the Infrastructure." — tagline reference |
| ESLint setup | `site/.eslintrc.*` | Extend for doc linting |
| Makefile | `Makefile` | Add `lint-docs` target |
| Proto docs standards | `stigmer-cloud/docs/proto-api-resource-standards.md` | Reference for API doc patterns |

---

## Open Questions for Review

1. **Framework choice**: Fumadocs vs Nextra vs custom MDX pipeline? Fumadocs is recommended for its headless/composable design matching Stigmer's philosophy, but Nextra is more battle-tested. A custom pipeline gives full control but is more work.

2. **Content location**: Should MDX content live in `site/content/docs/` (co-located with the site) or remain in `docs/` at the repo root (current location)? Fumadocs can source from either, but co-location simplifies the build. Root-level `docs/` keeps docs accessible to people who don't touch the site.

3. **Tagline**: The site hero says "Build Agents. Skip the Infrastructure." — should the docs landing use the same tagline or something docs-specific? Temporal uses "Build applications that never fail." You mentioned "build agents that never fail" as a possibility.

4. **Scope of quickstart**: Should the CLI Quickstart include creating a workflow (like Temporal's Hello World with Activity + Workflow + Worker + Start), or just an agent? The minimal path is: install → start server → create agent YAML → run agent → see output. Workflow quickstart could be a separate page.

5. **`output: "export"` constraint**: If Fumadocs requires server-side features that break static export, are you open to changing the deployment strategy (e.g., Vercel, Cloudflare Pages with SSR)? Or must it remain static GitHub Pages?

6. **Doc linting strictness**: Should doc linting be a blocking CI gate from day one, or advisory-only initially while existing docs are migrated?

---

## Success Criteria

- [ ] `/docs` route works and renders the docs landing page
- [ ] Sidebar navigation shows the defined information architecture
- [ ] On-page TOC renders for long docs
- [ ] At least one quickstart page (CLI) is rendered with full structure
- [ ] 2-3 concept docs are migrated and rendering correctly
- [ ] `make lint-docs` runs and validates documentation against standards
- [ ] Terminology linter catches prohibited terms
- [ ] Cursor rules exist and inject standards when editing doc files
- [ ] Document Writer role (`002_document_writer.md`) references new standards
- [ ] Documentation standards document exists with templates for all doc types
- [ ] Site builds successfully with `yarn build` (static export works)
- [ ] Docs theme matches the existing site design (dark, blue/purple, `--stgm-*` tokens)

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Fumadocs breaks with `output: "export"` | Phase 2 includes static export verification early. Fallback: `next-mdx-remote` custom pipeline. |
| 116 existing docs are in different formats | Phase 1 creates standards first; Phase 5 migrates only 2-3 as proof. Full migration is a separate project. |
| Fumadocs default theme clashes with `--stgm-*` tokens | Phase 2 includes explicit CSS override layer. Fumadocs exposes CSS variables that can be remapped. |
| MDX has a learning curve | Templates and cursor rules reduce the learning curve for content authors. |
| Linting rules are too strict initially | Phase 4 linting starts advisory-only; strictness increases as docs are migrated. |

---

## Notes

- This project is about **establishing patterns**, not about **writing all the documentation**. Content authoring at scale is a continuous effort that follows this project.
- The cursor rules and reminders are the highest-leverage deliverables — they ensure every future AI interaction that creates docs follows the established patterns.
- The quickstart is deliberately thin in Phase 5 — it proves the system works, but polishing it is a content project, not an infrastructure project.
- The terminology linter is critical for the "ubiquitous language is sacred" mandate in the Document Writer role.
