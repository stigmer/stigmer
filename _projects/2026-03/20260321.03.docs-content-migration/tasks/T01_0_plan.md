# Task T01: Docs Content Migration — Plan

**Created**: 2026-03-21 16:11
**Status**: PENDING REVIEW
**Type**: Migration

⚠️ **This plan requires your review before execution**

---

## Problem Statement

The Stigmer docs site has the right framework (Fumadocs, standards, templates, linting) but the content is rough:

1. **Stale content.** The CLI quickstart says Docker is a prerequisite — it's not. The concept docs may contain other outdated architecture claims. Content was written by AI sessions that sometimes hallucinated implementation details.
2. **ASCII art diagrams.** Resource trees and architecture flows render as monospace `text` code blocks with copy buttons. They look like terminal output, not professional documentation.
3. **Cramped typography.** Paragraphs have insufficient spacing. Heading margins are too tight. The reading experience doesn't match professional docs sites like docs.temporal.io.
4. **Plain home page.** "Stigmer Docs" as the title, basic cards, no visual personality. Temporal has colorful SDK language icons — we have nothing comparable.
5. **~100 legacy .md files** in `docs/` that aren't surfaced in the docs site — some are valuable public content, some are internal engineering notes, some are stale.

---

## Inventory

### Currently live on the docs site (5 .mdx files)

| File | Content type | Issues |
|---|---|---|
| `docs/index.mdx` | Landing page | Plain cards, generic copy, "Stigmer Docs" title |
| `docs/quickstarts/cli.mdx` | Quickstart | **Docker prerequisite is wrong**, needs validation |
| `docs/concepts/stigmer.mdx` | Concept | ASCII art resource tree + architecture diagram, needs diagram replacement |
| `docs/concepts/agent.mdx` | Concept | ASCII art layer diagram, needs diagram replacement |
| `docs/concepts/index.mdx` | Section landing | Minimal, "Core Concepts" |

### Legacy .md files by directory (candidates for migration)

| Directory | Count | Nature | Disposition |
|---|---|---|---|
| `docs/product/` | 22 | "What is X?" concept docs | **Migrate** → `docs/concepts/*.mdx` |
| `docs/cli/` | 4 | CLI usage guides | **Migrate** → `docs/cli/*.mdx` |
| `docs/guides/` | 18 | How-to guides, env vars, recipes | **Migrate** selectively → `docs/guides/*.mdx` |
| `docs/getting-started/` | 1 | Local mode quickstart | **Migrate** → merge into quickstarts or guides |
| `docs/architecture/` | 27 | Design docs, internals | **Triage** — some public, some internal-only |
| `docs/adr/` | 11 | Architecture decision records | **Triage** — migrate valuable ones to `.mdx` |
| `docs/implementation/` | 10 | Implementation notes | **Archive** — internal engineering artifacts |
| `docs/sdk/` | 10 | SDK dev guides | **Triage** — some public, some internal |
| `docs/engineering/` | 1 | Adding new models | **Triage** |
| `docs/deployment/` | 2 | systemd setup | **Triage** |
| `docs/audit-reports/` | 5 | SDK codegen review | **Archive** — internal |
| `docs/standards/` | 10 | Standards + templates | **Keep as-is** (excluded from Fumadocs sourcing) |

**Total**: ~121 legacy .md files + 5 existing .mdx files + 10 standards files (untouched).

---

## Phases

### Phase 1: Foundation — Typography, Diagrams, and Standards Updates

**Goal**: Fix the visual foundation so everything we migrate looks good from the start.

**Deliverables**:

1. **Fix docs typography/spacing (CSS)**
   - Increase paragraph margins, heading spacing, line height in the docs layout
   - Ensure code blocks have proper surrounding whitespace
   - Verify changes are scoped to `/docs` and don't affect the marketing site
   - File: `site/src/app/globals.css` or a new docs-specific CSS file

2. **Evaluate and implement diagram approach**
   - Evaluate options: Mermaid (rendered at build time), custom MDX components (`<ResourceTree>`, `<FlowDiagram>`, `<ArchitectureDiagram>`), or a lightweight library
   - Mermaid pros: standard, zero custom code, supported by Fumadocs via rehype plugins
   - Custom MDX component pros: more visual control, can match the site's design language
   - Decision: pick one approach and implement it
   - Test with the resource tree from `stigmer.mdx` and the architecture diagram

3. **Update documentation standards**
   - Add diagram mandate: "Use [chosen approach] for all diagrams. Never use `text` code blocks for visual structures."
   - Add stale content validation rule: "Every factual claim about implementation behavior must be validated against the current codebase before publishing."
   - Update `docs/standards/documentation-standards.md`
   - Update `.cursor/rules/docs/documentation-standards.mdc`
   - Update `_reminders/004_documentation-standards.md`

**Files touched**: `site/src/app/globals.css`, `docs/standards/documentation-standards.md`, `.cursor/rules/docs/documentation-standards.mdc`, `_reminders/004_documentation-standards.md`, possibly `site/next.config.ts` (for Mermaid plugin), possibly `site/src/app/docs/[[...slug]]/page.tsx` (for custom MDX components)

### Phase 2: Fix Existing MDX Content

**Goal**: Make the 5 live pages production-quality before adding more.

**Deliverables**:

1. **Fix CLI quickstart (`docs/quickstarts/cli.mdx`)**
   - Remove Docker prerequisite — the server is a single binary, no Docker needed
   - Validate every step against the current CLI implementation
   - Verify expected outputs match real CLI behavior

2. **Replace ASCII diagrams in concept docs**
   - `docs/concepts/stigmer.mdx`: resource tree (lines 214-236), runtime architecture (lines 243-254)
   - `docs/concepts/agent.mdx`: four-layer diagram (lines 147-149)
   - Replace with the diagram approach chosen in Phase 1

3. **Improve docs home page (`docs/index.mdx`)**
   - Add colorful SDK/language icons (Go, Python, TypeScript) — Temporal-style visual row
   - Improve hero copy: more compelling than "Build Agents. Skip the Infrastructure."
   - Change sidebar label from "Stigmer Docs" to "Home" (update `docs/meta.json`)
   - Better section card descriptions

4. **Validate all factual claims in existing MDX**
   - Cross-reference concept doc claims against current codebase
   - Flag and fix any stale information

**Files touched**: `docs/quickstarts/cli.mdx`, `docs/concepts/stigmer.mdx`, `docs/concepts/agent.mdx`, `docs/index.mdx`, `docs/meta.json`, `site/src/app/docs/[[...slug]]/page.tsx` (if new MDX components added)

### Phase 3: Migrate Public Content (product/ → concepts/)

**Goal**: Convert the 22 "What is X?" docs from `.md` to `.mdx` and surface them on the site.

**Approach per file**:
1. Read the `.md` source
2. **Validate every factual claim** against current code (this is the critical step)
3. Apply the concept template structure
4. Convert to `.mdx` with proper frontmatter
5. Replace any ASCII diagrams with proper visual elements
6. Run `make lint-docs` to verify
7. Add to `docs/concepts/meta.json`

**Files**: `docs/product/what-is-*.md` → `docs/concepts/*.mdx` (22 files)

**Note**: Two files (`what-is-stigmer.md`, `what-is-agent.md`) were already migrated in the previous project. Remaining: ~20 concept docs.

### Phase 4: Migrate CLI and Guides Content

**Goal**: Convert CLI docs and how-to guides to `.mdx`.

**Deliverables**:

1. **CLI docs** (`docs/cli/` → `docs/cli/*.mdx`) — 4 files
   - `configuration.md`, `managing-agents.md`, `running-agents-workflows.md`, `server-logs.md`
   - Validate against current CLI commands

2. **Guides** (`docs/guides/` → `docs/guides/*.mdx`) — selective migration
   - Triage: which guides are still accurate and useful?
   - High-priority: `deploying-with-apply.md`, `creating-and-versioning-skills.md`, `using-mcp-servers.md`, `durable-execution.md`
   - Lower-priority or stale: `org-slug-migration.md`, `temporal-*` operational guides (may be internal)

3. **Getting started** (`docs/getting-started/local-mode.md`)
   - Merge into quickstarts or guides, avoid duplication with CLI quickstart

4. Add `meta.json` files for new sections, update `docs/meta.json` sidebar ordering

**Files touched**: ~15-20 files migrated, new `meta.json` files for `docs/cli/` and `docs/guides/`

### Phase 5: Triage Internal Docs

**Goal**: Decide the fate of architecture docs, ADRs, implementation notes, SDK docs, and audit reports.

**Approach**:
- **Public-worthy architecture docs** → migrate to `docs/architecture/*.mdx`
- **Valuable ADRs** → migrate to `docs/adr/*.mdx`
- **Internal engineering notes** → leave as `.md` (excluded from Fumadocs by path or convention)
- **Stale/obsolete content** → flag for archival

This phase is lower priority and can be deferred. The critical content (concepts, CLI, guides) is in Phases 3-4.

**Deliverables**: A triage document (`docs-triage.md`) listing every file with its disposition (migrate/keep/archive), plus migration of any high-value architecture docs.

### Phase 6: Final Verification

**Goal**: Everything works, everything passes.

**Deliverables**:
1. `make lint-docs` passes on all `.mdx` files (0 issues)
2. `yarn build` (Node 20) succeeds — all pages generate
3. All internal links resolve
4. Visual spot-check of key pages (home, quickstart, concepts)
5. Update project checkpoint

---

## What This Project Does NOT Touch

- Sales website (`site/src/` marketing pages) — beyond docs-specific CSS
- CLI source code — we document it, we don't change it
- SDK source code
- `docs/standards/` templates — they're already done (Phase 1 of previous project)
- Fumadocs framework setup — already done (Phase 2 of previous project)

---

## Open Questions (for review)

1. **Diagram approach**: Mermaid (standard, zero custom code, built-in Fumadocs support) vs. custom MDX components (more visual control, matches site design). Leaning Mermaid for now — simpler, standard, works in GitHub previews too. But open to discussion.

2. **Content triage depth**: Phase 5 (internal docs) could be a separate project entirely. Should we include it here or defer?

3. **SDK language icons on the home page**: Temporal uses Go, Java, PHP, TypeScript, .NET, Rust icons. Our SDKs are Go, Python, TypeScript. Should we show all three even though Python and TypeScript SDKs are not yet released? Or show Go (available) and mark others as "Coming Soon"?

4. **Architecture docs**: Some are genuinely useful for developers (e.g., `temporal-integration.md`, `backend-modes.md`, `skill-versioning.md`). Migrate those to public docs, or keep them internal?

---

## Execution Order

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 (optional) → Phase 6

Each phase is independently shippable — we can merge after any phase and the site improves.

---

## Review Process

**What happens next**:
1. **You review this plan** — consider the phases, open questions, and scope
2. **Provide feedback** — concerns, additions, priority changes
3. **I'll revise the plan** — incorporate feedback into `T01_2_revised_plan.md`
4. **You approve** — explicit go-ahead
5. **Execution begins** — tracked in `T01_3_execution.md`
