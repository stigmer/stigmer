# Plan: Content Framework Cleanup (Revised)

## The Problem

Two previous foundation projects created an over-engineered system: 9 roles, 8 reminders, 6 cursor rules, 24 template files (descriptions of what to build), and 10+ standards docs. The result:

- **Docs pages are walls of raw text** — no visual components, no breadcrumbs, no variety
- **Templates describe components instead of being components** — 7 doc templates + 17 site templates are markdown descriptions of what a page should look like, not actual reusable components
- **Too many things to drag** — roles, reminders, rules don't compose into a simple workflow
- **Duplicate content everywhere** — same audience definition in 4 places
- **Rules try to compensate** for missing component infrastructure

## The Solution: Components Replace Templates, Two Roles Replace Nine

### Core Insight

Instead of `.md` files that describe "a concept page should have these sections," build actual components that enforce it. The component IS the standard. Content authors fill in slots; the structure and visual quality are guaranteed.

This already works for the sales website — `<Hero>`, `<Features>`, `<Architecture>` are components, not descriptions. Docs need the same treatment.

### The Framework (same for docs and site)

| Layer | What it controls | Who owns it |
|---|---|---|
| **Theme** | Colors, typography, spacing, tokens | Content UX role |
| **Layout** | Page structure, navigation, breadcrumbs | Content UX role |
| **Components** | Reusable building blocks | Content UX role |
| **Content** | The actual words filling those components | Content Author role |

### What Gets Consolidated

**Roles: 9 → 5**

| Role | Action | Reason |
|---|---|---|
| 001_architect | Keep | Not content-related |
| 002_document_writer | Delete → merged into new content_author | |
| 003_cli_tui_ux_eng | Keep | Not content-related |
| 004_web_ux_ui | Keep | Console role, works well |
| 005_ai_engineer | Keep | Not content-related |
| 006_ux_designer | Keep | Console role, works well |
| 007_growth_marketing_strategist | Delete → merged into new content_author | |
| 008_sales_website_designer | Delete → merged into new content_ux | |
| 009_developer_copywriter | Delete → merged into new content_author | |
| **New: content_author** | Create | Writes content for docs and site — fills component slots |
| **New: content_ux** | Create | Builds and maintains components, layouts, theme for docs and site |

**Reminders: 8 → 4**

| Reminder | Action | Reason |
|---|---|---|
| 001_plan-first | Keep | Universal |
| 002_collaboration-principles | Keep | Universal |
| 003_platform-for-platforms | Keep | SDK architecture, not content |
| 004_documentation-standards | Delete | Pointer to other files, no unique value |
| 005_sales-website-mindset | Delete → merged | Good principles, merge into new reminder |
| 006_developer-marketing-principles | Delete → merged | Good principles, merge into new reminder |
| 007_documentation-for-platform-builders | Delete → merged | Already duplicated in cursor rule |
| 008_website-standards | Delete | Pointer to other files, no unique value |
| **New: content_quality** | Create | Short (<30 lines). Audience, show-don't-tell, honesty, specificity |

**Cursor Rules: 6 → 2**

| Rule | Action |
|---|---|
| docs/documentation-standards.mdc | Delete → replaced |
| docs/write-documentation.mdc | Delete → replaced |
| docs/review-documentation.mdc | Delete → replaced |
| **New: docs/docs-content.mdc** | Create — lean auto-apply: terminology, file conventions, available components list |
| site/website-standards.mdc | Delete → replaced |
| site/write-website-content.mdc | Delete → replaced |
| site/review-website-content.mdc | Delete → replaced |
| **New: site/site-content.mdc** | Create — lean auto-apply: terminology, copy rules, available components list |

**Templates → Components**

| What exists | Action |
|---|---|
| `docs/standards/templates/` (7 `.mdx` template files) | Delete all — replaced by actual MDX components |
| `site/standards/templates/` (17 `.md` template files) | Delete all — the site already has real section components; these descriptions add no value |
| `docs/standards/documentation-standards.md` | Delete — duplicates cursor rule |
| `docs/standards/information-architecture.md` | Delete — structure is self-evident from the file tree |
| `docs/standards/terminology.json` | Keep — machine-readable, referenced by rules |
| `site/standards/website-standards.md` | Delete — duplicates cursor rule |
| `site/standards/information-architecture.md` | Review — may still be useful for page map |
| `site/standards/component-standards.md` | Delete — the components themselves are the standard |
| `site/standards/performance-budget.json` | Keep — machine-readable budget |
| `site/standards/copy-guidelines.json` | Keep — machine-readable banned phrases |
| `site/standards/content-requirements.json` | Delete — the components enforce this |

## Phases

### Phase 1: Audit & Cleanup

Clean up roles, reminders, rules, and template/standards files.

**Deliverables:**
1. Write the new `content_author` role
2. Write the new `content_ux` role
3. Write the new `content_quality` reminder
4. Delete replaced roles (002, 007, 008, 009)
5. Delete replaced reminders (004, 005, 006, 007, 008)
6. Write 2 lean cursor rules (docs-content.mdc, site-content.mdc)
7. Delete old cursor rules (3 docs + 3 site)
8. Delete template files (7 docs + 17 site)
9. Delete redundant standards files

**What it touches:**
- `_roles/` — delete 4, create 2
- `_reminders/` — delete 5, create 1
- `.cursor/rules/docs/` — replace 3 with 1
- `.cursor/rules/site/` — replace 3 with 1
- `docs/standards/templates/` — delete directory
- `site/standards/templates/` — delete directory
- `docs/standards/` — prune redundant files
- `site/standards/` — prune redundant files

### Phase 2: Docs Component Library

Build actual components that replace the deleted templates. Wire up Fumadocs built-ins + build custom doc components.

**Fumadocs built-ins to wire up:**
- `Callout` — info, warning, tip callout boxes
- `Tab` / `Tabs` — tabbed content (OS selection, language selection)
- `Step` / `Steps` — numbered step sequences with visual treatment
- `Accordion` — expandable sections for secondary content
- Breadcrumbs — layout configuration

**Custom doc components to build:**
- `DefinitionBanner` — the opening "what is X" statement with container analogy badge
- `ProblemStatement` — visually distinct "what goes wrong" section with icon bullets
- `ComparisonTable` — styled "without/with Stigmer" two-column comparison
- `QuickExample` — a getting-started code block with copy button and context label
- `RelatedDocs` — styled "further reading" card grid
- `PropertyTable` — formatted key properties table for resource docs

Each of these replaces a section from the old template files. The component guarantees the visual quality.

**What it touches:**
- `site/src/app/docs/layout.tsx` — breadcrumbs
- `site/src/app/docs/[[...slug]]/page.tsx` — register components in MDX map
- `site/src/components/mdx/` — new component files
- `site/src/app/globals.css` — docs-specific design tokens if needed

### Phase 3: Proof — Rewrite One Doc

Rewrite `docs/concepts/what-is-stigmer.mdx` using the new component library.

Before: walls of text with headings, code blocks, and tables.
After: `DefinitionBanner`, `ProblemStatement`, `ComparisonTable`, `Steps`, `Callout`, `RelatedDocs` — the same content but with visual structure guaranteed by components.

### Phase 4: Finalize Workflow

Update next-task.md with the final per-conversation instructions.

**The end-state workflow:**

For content writing:
```
1. Drag: @_roles/010_content_author.md
2. Drag: @_reminders/009_content_quality.md
3. Drag: @_projects/.../next-task.md
4. Work — compose components, fill in content
```

For component building/UX work:
```
1. Drag: @_roles/011_content_ux.md
2. Drag: @_reminders/009_content_quality.md
3. Work on a specific component
```

## Out of Scope

- Rewriting all 5 concept docs (Phase 3 rewrites one as proof)
- Redesigning sales website pages
- Touching console roles (004, 006) or non-content roles (001, 003, 005)
- Building site page-level components (those already work)

## Decision Log

| Decision | Rationale |
|---|---|
| Keep 004_web_ux_ui and 006_ux_designer | Console roles, working well, not content-related |
| Two content roles (author + UX) not one | Different skills, different conversations |
| Templates → components | Components enforce structure; templates only describe it |
| Delete site/standards/templates/ | Site already has real components; template .md files are redundant descriptions |
| Keep terminology.json, performance-budget.json, copy-guidelines.json | Machine-readable, referenced programmatically |
