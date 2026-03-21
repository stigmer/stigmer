# Revised Plan: Content Framework Cleanup

## The Problem

Two foundation projects created a sprawling system that doesn't produce good results: 9 roles, 8 reminders, 6 cursor rules, 24 template files (.md descriptions of what to build), and 10+ standards docs. The docs pages are still walls of raw text. The framework is noise, not signal.

## The Solution

1. **Three content roles** that mirror how the console has 004 (engineer) and 006 (designer)
2. **No reminders** — two short text snippets pasted into conversations instead
3. **Components replace templates** — build the actual things, not descriptions of them
4. **Lean rules** — only what needs auto-enforcement

---

## Three Content Roles

The console has two roles that work well: 006_ux_designer (decides how things should look) and 004_web_ux_ui (builds the implementation). Content needs the same split, plus a writer.

| # | Role | Mirrors | Responsibility |
|---|---|---|---|
| 010 | **Content Designer** | 006_ux_designer | Decides how docs/site pages should look. Visual hierarchy, component design, layout decisions, information architecture. The person who says "a concept page needs a definition banner, a problem section, and a comparison table." |
| 011 | **Content Author** | — | Writes the content that fills components. Explanations, code examples, copy, diagrams. The person who writes "An Agent is a portable blueprint that defines what an AI worker can do." Covers both docs and site. |
| 012 | **Content Engineer** | 004_web_ux_ui | Builds the actual React/MDX components. Makes sure everything is componentized. Implements what the Content Designer designed. The person who builds `<DefinitionBanner>`, `<ProblemStatement>`, `<ComparisonTable>`. |

**Roles to delete:**
- 002_document_writer → merged into 011_content_author
- 007_growth_marketing_strategist → merged into 011_content_author
- 008_sales_website_designer → merged into 010_content_designer
- 009_developer_copywriter → merged into 011_content_author

**Roles untouched:**
- 001_architect (domain modeling)
- 003_cli_tui_ux_eng (terminal experience)
- 004_web_ux_ui (console implementation)
- 005_ai_engineer (AI/ML)
- 006_ux_designer (console design)

---

## Reminders: Delete All, Replace with Two Text Snippets

Delete the entire `_reminders/` directory. All 8 files go.

Instead, create two short text snippets (delivered as part of this plan) that the user copies and pastes into every content conversation. These mirror the two snippets already used for console work:

### Snippet 1: Content Context (mirrors the "platform for platforms" snippet)

This tells the AI what Stigmer content is about — the audience, the surfaces, the quality bar. Short, dense, motivating.

### Snippet 2: Content Quality (mirrors the "don't get complacent" snippet)

This sets the quality expectation — no garbage content, no walls of text, component-first thinking, push boundaries.

Both snippets will be written as Phase 1 deliverables.

---

## Rules: Clean Up

Delete all 6 cursor rules (3 docs + 3 site). Keep only if there's a genuine auto-enforcement need.

**What might survive as a single lean rule:** Terminology enforcement. When editing `docs/**` or `site/src/**`, auto-inject the terminology constraints (AgentExecution not "agent run", etc.) so the AI doesn't need to be reminded. This is the one thing that benefits from auto-apply — everything else goes into roles.

Decision: 6 rules → 0 or 1.

---

## Templates: Delete All, Replace with Components

**Delete:**
- `docs/standards/templates/` — 7 files (concept.mdx, quickstart.mdx, etc.)
- `site/standards/templates/` — 17 files (homepage.md, section-hero.md, etc.)

**Delete redundant standards files:**
- `docs/standards/documentation-standards.md` — duplicates rules
- `docs/standards/information-architecture.md` — structure is self-evident from file tree
- `site/standards/website-standards.md` — duplicates rules
- `site/standards/component-standards.md` — the components themselves are the standard
- `site/standards/information-architecture.md` — review, likely redundant
- `site/standards/content-requirements.json` — components enforce requirements

**Keep:**
- `docs/standards/terminology.json` — machine-readable, referenced programmatically
- `site/standards/performance-budget.json` — machine-readable targets
- `site/standards/copy-guidelines.json` — machine-readable banned phrases

---

## Phases

### Phase 1: Clean Up (roles, reminders, rules, templates, standards)

**Deliverables:**

1. Write role `010_content_designer.md`
2. Write role `011_content_author.md`
3. Write role `012_content_engineer.md`
4. Write the two text snippets (content context + content quality)
5. Delete roles: 002, 007, 008, 009
6. Delete all reminders: 001 through 008
7. Delete or consolidate cursor rules (6 → 0 or 1)
8. Delete template files: `docs/standards/templates/` (7 files) + `site/standards/templates/` (17 files)
9. Delete redundant standards files

**What it touches:**
- `_roles/` — delete 4, create 3
- `_reminders/` — delete all 8
- `.cursor/rules/docs/` — delete 3 (possibly create 1 lean rule)
- `.cursor/rules/site/` — delete 3 (possibly create 1 lean rule)
- `docs/standards/` — delete templates dir + redundant docs, keep terminology.json
- `site/standards/` — delete templates dir + redundant docs, keep JSON files

### Phase 2: Docs Component Library

Build actual MDX components that replace every template. The component IS the standard — content authors compose them, and the visual quality is guaranteed.

**Fumadocs built-ins to wire up:**
- `Callout` — info, warning, tip boxes
- `Tab` / `Tabs` — tabbed content (OS, language, before/after)
- `Step` / `Steps` — numbered sequences with visual treatment
- `Accordion` — expandable secondary content
- Breadcrumbs — layout config

**Custom doc components to build (one per deleted template pattern):**

| Component | Replaces template pattern | What it does |
|---|---|---|
| `<DefinitionBanner>` | Concept template "Definition" section | Opening statement with container analogy badge |
| `<ProblemStatement>` | Concept template "Problem" section | Visually distinct "what goes wrong" with icon bullets |
| `<ComparisonTable>` | Concept template "How it compares" | Styled two-column without/with comparison |
| `<QuickExample>` | Multiple templates "Getting started" | Code block with context label, copy button |
| `<RelatedDocs>` | Multiple templates "Further reading" | Card grid linking to related pages |
| `<PropertyTable>` | Concept template "Key properties" | Formatted property reference table |
| `<Prerequisites>` | Quickstart template prerequisites | Checkbox list of requirements |
| `<StepSequence>` | Quickstart template steps | Wraps Fumadocs Steps with Stigmer styling |

Each component takes content as props/children. The structure is fixed; only content varies. AI sees the component, knows exactly what slot to fill.

**What it touches:**
- `site/src/app/docs/layout.tsx` — breadcrumbs
- `site/src/app/docs/[[...slug]]/page.tsx` — register components in MDX map
- `site/src/components/mdx/` — new component files
- `site/src/app/globals.css` — docs design tokens if needed

### Phase 3: Proof — Rewrite One Doc with Components

Rewrite `docs/concepts/what-is-stigmer.mdx` using the new component library.

The MDX file becomes a composition of components that receive content:

```mdx
<DefinitionBanner analogy="Kubernetes for containers">
  Stigmer is an infrastructure platform for AI agents.
</DefinitionBanner>

<ProblemStatement title="Building AI agents from scratch does not scale">
  <Problem>Agent definitions live in application code</Problem>
  <Problem>Conversation state is ad hoc</Problem>
  <Problem>No execution control</Problem>
</ProblemStatement>

<ComparisonTable
  without="Agent definitions live in application code"
  with="Agents are versioned YAML resources"
/>
```

Content authors fill slots. The visual treatment is guaranteed by the component. AI sees this pattern and can replicate it perfectly.

### Phase 4: Finalize Workflow

Update `next-task.md` with the final per-conversation instructions.

**For content writing:**
```
1. Paste: content context snippet
2. Paste: content quality snippet
3. Drag: @_roles/011_content_author.md
4. Drag: @_projects/.../next-task.md
5. Work — compose components, fill in content
```

**For component design:**
```
1. Paste: content context snippet
2. Paste: content quality snippet
3. Drag: @_roles/010_content_designer.md
4. Work on a specific component's design
```

**For component building:**
```
1. Paste: content context snippet
2. Paste: content quality snippet
3. Drag: @_roles/012_content_engineer.md
4. Work on a specific component's implementation
```

---

## Out of Scope

- Rewriting all 5 concept docs (Phase 3 rewrites one as proof)
- Redesigning sales website pages
- Touching console roles (004, 006)
- Building site page-level components (those already work)

## Decision Log

| Decision | Rationale |
|---|---|
| Three content roles (designer, author, engineer) | Mirrors console pattern (006 designs, 004 builds). Different conversations need different expertise. |
| Delete all reminders | User prefers pasting short snippets. Reminders were too long and treated as noise. |
| Templates → components | Components enforce structure; templates only describe it. AI can't invent structure from descriptions, but can compose components reliably. |
| Delete all 6 cursor rules (maybe keep 1) | User never uses rules. Only terminology enforcement benefits from auto-apply. |
| AI-friendly framework | Components with clear slots mean AI knows exactly what to modify. No invention needed. |
