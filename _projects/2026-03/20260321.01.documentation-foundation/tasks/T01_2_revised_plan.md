# Task T01 (Revised): Documentation Foundation — Standards, Framework, and Patterns

**Created**: 2026-03-21
**Revised**: 2026-03-21 (post-review)
**Status**: Approved — ready for execution

## Decisions Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| Framework | **Fumadocs** | Native Next.js App Router, headless/composable, aligns with platform-for-platforms philosophy |
| Content location | **Repo root `docs/`** | Source from `../docs` in `source.config.ts`. Keeps docs accessible to repo browsers; site build picks them up. |
| Tagline | **"Build Agents. Skip the Infrastructure."** | Reuse existing site tagline for consistency; docs landing adapts it for the docs context |
| Quickstart scope | **Agent only** | Install → start server → create agent YAML → run agent → verify output. No workflow. |
| Static export | **Yes, `output: "export"`** | Fumadocs officially supports static export. Search uses Orama static mode. |
| Lint strictness | **`make check` integration** | `make lint-docs` added to `make check`. Runs locally before every commit. No separate CI step needed. |

---

## Architecture (Revised)

### Content Sourcing

```
stigmer/                          ← repo root
├── docs/                         ← content lives here (accessible via GitHub)
│   ├── meta.json                 ← Fumadocs sidebar ordering for root
│   ├── index.mdx                 ← Docs landing page (/docs)
│   ├── quickstarts/
│   │   ├── meta.json             ← sidebar ordering
│   │   ├── index.mdx             ← Quickstart overview
│   │   └── cli.mdx               ← CLI Quickstart (the deal-breaker)
│   ├── concepts/
│   │   ├── meta.json
│   │   ├── index.mdx
│   │   ├── stigmer.mdx           ← migrated from product/what-is-stigmer.md
│   │   ├── agent.mdx             ← migrated from product/what-is-agent.md
│   │   └── ...
│   ├── guides/                   ← existing guides/ adapted
│   ├── cli/                      ← CLI reference
│   ├── architecture/             ← deep dives
│   ├── sdk/                      ← SDK guides (future)
│   │   ├── go/
│   │   ├── typescript/
│   │   └── python/
│   ├── standards/                ← documentation standards (new)
│   │   ├── documentation-standards.md
│   │   ├── terminology.json
│   │   └── templates/
│   │       ├── concept.mdx
│   │       ├── quickstart.mdx
│   │       ├── sdk-guide.mdx
│   │       ├── how-to-guide.mdx
│   │       ├── cli-reference.mdx
│   │       ├── architecture.mdx
│   │       └── adr.mdx
│   ├── product/                  ← existing what-is-*.md (to be migrated)
│   ├── adr/                      ← existing ADRs
│   └── README.md                 ← existing index (kept for GitHub browsing)
│
├── site/
│   ├── source.config.ts          ← Fumadocs: sources from ../docs
│   ├── src/app/docs/
│   │   ├── layout.tsx            ← docs layout (sidebar + TOC)
│   │   └── [[...slug]]/
│   │       └── page.tsx          ← dynamic MDX renderer
│   └── ...existing site
```

**Key**: `source.config.ts` in `site/` points to `../docs` via the `dir` property in the collection definition. Fumadocs-mdx processes the files at build time, and the static export generates HTML for every page.

### Sidebar Navigation (Information Architecture)

```
Docs Home
├── Quickstarts
│   ├── CLI Quickstart
│   ├── Go SDK (Coming Soon)
│   ├── TypeScript SDK (Coming Soon)
│   └── Python SDK (Coming Soon)
├── Concepts
│   ├── What is Stigmer?
│   ├── Agents
│   ├── Skills
│   ├── Sessions
│   ├── Workflows
│   ├── MCP Servers
│   ├── Organizations
│   └── Environments
├── Guides
│   ├── Environment Variables
│   ├── Using MCP Servers
│   ├── Deploying with Apply
│   ├── Durable Execution
│   └── ...
├── CLI Reference
│   ├── stigmer new
│   ├── stigmer run
│   ├── stigmer apply
│   └── ...
├── SDK Guides
│   ├── Go SDK
│   ├── TypeScript SDK
│   └── Python SDK
└── Architecture
    ├── Backend Modes
    ├── Temporal Integration
    └── ...
```

### Docs Landing Page (`/docs`)

```
┌──────────────────────────────────────────────────────────────┐
│  Stigmer Docs                                                │
│                                                              │
│  Build Agents. Skip the Infrastructure.                      │
│  Everything you need to create, run, and integrate           │
│  autonomous agents into your platform.                       │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ ⚡ Quickstart │ │ 📖 Concepts  │ │ 🔧 CLI Ref   │        │
│  │ Get running  │ │ Core ideas   │ │ Command docs │        │
│  │ in 5 minutes │ │ and models   │ │ and usage    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐                          │
│  │ 📚 Guides    │ │ 🏗 SDK Guides │                          │
│  │ How-to docs  │ │ Go, TS, Py   │                          │
│  │ and recipes  │ │ integration  │                          │
│  └──────────────┘ └──────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

---

## Phases (Revised — No Changes to Structure)

### Phase 1: Standards & Content Architecture (No Code)

Unchanged from original plan. Deliverables:
1. Documentation Standards Document (`docs/standards/documentation-standards.md`)
2. Doc Type Templates (`docs/standards/templates/*.mdx`)
3. Information Architecture Map (sidebar tree, URL scheme)
4. Terminology Lint Dictionary (`docs/standards/terminology.json`)

### Phase 2: Framework Integration (Fumadocs + Next.js)

Revised for root-sourcing and static export:

1. **Install Fumadocs packages** in `site/`
   - `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`
   - Orama for static search

2. **Source configuration** (`site/source.config.ts`)
   - `dir: '../docs'` to source from repo root
   - Frontmatter schema definition
   - Content collection setup

3. **Next.js config update** (`site/next.config.ts`)
   - Integrate `createMDX` from `fumadocs-mdx/next`
   - Keep `output: "export"` and `images.unoptimized: true`

4. **Docs layout** (`site/src/app/docs/layout.tsx`)
   - Left sidebar with collapsible tree (Fumadocs `DocsLayout`)
   - Right on-page TOC
   - Themed with `--stgm-*` tokens

5. **Docs catch-all route** (`site/src/app/docs/[[...slug]]/page.tsx`)
   - `generateStaticParams()` for static export
   - MDX body renderer
   - Breadcrumbs

6. **Theme override** (`site/src/app/docs/docs-theme.css` or inline overrides)
   - Map Fumadocs CSS variables → `--stgm-*` tokens
   - Dark theme, code block styling

7. **Search** — Orama static mode
   - Pre-built search index at build time
   - Search dialog in docs layout

8. **Header integration**
   - `/docs` link in header already exists — just needs working route

### Phase 3: Cursor Rules & Reminders

Unchanged from original plan. Deliverables:
1. `write-documentation.mdc` — auto-injects standards when editing `docs/` files
2. `review-documentation.mdc` — action rule for doc quality checklist
3. `write-quickstart.mdc` — quickstart-specific enforcement
4. `write-sdk-guide.mdc` — SDK guide-specific enforcement
5. Updated `_roles/002_document_writer.md`

### Phase 4: Documentation Linting

Revised for `make check` integration:

1. **Markdown linting** (`markdownlint-cli2`)
2. **Terminology linter** (custom script reading `terminology.json`)
3. **Link validation** (internal links resolve)
4. **Frontmatter validation** (required fields present)
5. **Makefile targets**:
   - `make lint-docs` — run all doc linters
   - `make fix-docs` — auto-fix where possible
   - `make check` — updated to include `lint-docs`

### Phase 5: Quickstart Skeleton & Content Seeding

Revised for agent-only quickstart:

1. **CLI Quickstart** (`docs/quickstarts/cli.mdx`)
   - Prerequisites (macOS/Linux, Go optional)
   - Install Stigmer CLI (`brew install stigmer` or binary)
   - Start the server (`stigmer server start`)
   - Create your first agent (YAML file with explanation)
   - Run the agent (`stigmer run`)
   - Verify it works (expected output)
   - Next steps (links to concepts, guides)
   - **No workflow content**

2. **Concepts index + 2-3 migrated docs**
   - `what-is-stigmer.md` → `docs/concepts/stigmer.mdx`
   - `what-is-agent.md` → `docs/concepts/agent.mdx`

3. **Quickstart index** with CLI card active, others "Coming Soon"

4. **Docs landing page** — polished `/docs` page

5. **Validation**: `yarn build` succeeds, `make lint-docs` passes, sidebar works

---

## Execution Order

```
Phase 1 (Standards)     ──→ Phase 2 (Framework)  ──→ Phase 3 (Cursor Rules)
                                                  ──→ Phase 4 (Linting)
                                                  ──→ Phase 5 (Content Seeding)
```

Phase 1 must complete first (standards define what the framework renders).
Phase 2 must complete second (framework must exist before content is seeded).
Phases 3, 4, 5 can proceed in parallel after Phase 2.

---

## Success Criteria (Unchanged)

- [ ] `/docs` route works and renders the docs landing page
- [ ] Sidebar navigation shows the defined information architecture
- [ ] On-page TOC renders for long docs
- [ ] CLI Quickstart page renders with agent-only flow
- [ ] 2-3 concept docs migrated and rendering correctly
- [ ] `make lint-docs` runs and validates docs against standards
- [ ] `make check` includes `lint-docs`
- [ ] Terminology linter catches prohibited terms
- [ ] Cursor rules inject standards when editing doc files
- [ ] Document Writer role references new standards
- [ ] Documentation standards document exists with all templates
- [ ] Site builds with `yarn build` (static export works)
- [ ] Docs theme matches site design (dark, `--stgm-*` tokens)

---

## Follow-Up Project: Documentation Content Migration

After this foundation project completes, a separate project is needed to migrate existing content into the new framework.

### Scope

- **Migrate ~54 public-facing docs** from `.md` to `.mdx` with proper frontmatter (product concepts, user guides, CLI reference, SDK guides, getting started)
- **Triage ~68 internal docs** — keep as `.md` for GitHub browsing (architecture, implementation, ADRs) or move to a dedicated internal/contributor section
- **Fix stale content** — 3-4 files still reference BadgerDB (replaced by SQLite), 2 conflicting SDK versioning docs, duplicate ADR-005
- **Archive completed audits** — `audit-reports/sdk-codegen-review-2026-01/` is a completed audit; archive or move out of `docs/`
- **Relocate config examples** — `.env.example`, `.env.secret.example`, `.gitignore.example` are templates, not docs; move to `examples/` or `templates/`
- **Content polish** — apply the standards and terminology linting established by this foundation project to all migrated content

### Prerequisites

All 5 phases of this foundation project must be complete — the migration project uses the framework, templates, standards, linting, and cursor rules established here.

### Estimated effort

1-2 weeks of content work (not code work). The framework, templates, and linting make this largely mechanical.
