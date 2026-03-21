# Reminder: Documentation Standards

When working on any file in `docs/`, these standards govern every decision.

## Reference Documents

All documentation standards, templates, and terminology are defined in `docs/standards/`:

| Document | What It Defines |
|---|---|
| [`docs/standards/documentation-standards.md`](../docs/standards/documentation-standards.md) | Master standards: mandates, content types, frontmatter schema, heading rules, code block rules, writing style, cross-referencing |
| [`docs/standards/information-architecture.md`](../docs/standards/information-architecture.md) | Sidebar tree, URL scheme, directory-to-route mapping, ordering conventions |
| [`docs/standards/terminology.json`](../docs/standards/terminology.json) | Machine-readable terminology dictionary — canonical terms and prohibited aliases |

## Templates

Every new document must use the correct template from `docs/standards/templates/`:

| Content Type | Template | Directory |
|---|---|---|
| "What is X?" concept doc | `concept.mdx` | `docs/concepts/` |
| 5-minute onboarding | `quickstart.mdx` | `docs/quickstarts/` |
| SDK-specific topic guide | `sdk-guide.mdx` | `docs/sdk/{language}/` |
| Task-oriented how-to | `how-to-guide.mdx` | `docs/guides/` |
| CLI command reference | `cli-reference.mdx` | `docs/cli/` |
| Design rationale | `architecture.mdx` | `docs/architecture/` |
| Decision record | `adr.mdx` | `docs/adr/` |

## The Five Mandates

1. **Ubiquitous language is sacred.** Proto names are the canonical names. If the proto says `AgentExecution`, the docs never say "agent run" or "job." Check `terminology.json`.
2. **Eliminate assumptions.** State every prerequisite. Define every acronym on first use. Every YAML example must be complete enough to `stigmer apply`.
3. **Active voice and imperative clarity.** "Configure the environment" — not "The environment should be configured." Remove hedging words.
4. **Structural hierarchy.** Follow the template. Use headings, tables, code blocks, and diagrams. Make content scannable.
5. **Analogies ground understanding.** Agent = Docker image, AgentExecution = `docker run`, Organization = Kubernetes namespace. Use these when they clarify.

## Before Writing Any Document

Follow the Doc Blueprint process from `_roles/002_document_writer.md`:

1. **Audience audit** — who is this for and what is their goal?
2. **Gap analysis** — what is missing, confusing, or outdated?
3. **Outline** — proposed structure with confirmation before drafting.

## Quality Checklist

Before merging any documentation change:

- [ ] Uses the correct template for its content type
- [ ] Frontmatter includes `title` and `description`
- [ ] Exactly one H1 matching the `title` field
- [ ] No skipped heading levels
- [ ] Every code block has a language tag
- [ ] YAML examples are valid YAML
- [ ] No prohibited terminology (check `terminology.json`)
- [ ] All relative links resolve to real files
- [ ] Active voice throughout instructions
- [ ] No hedging words (usually, sometimes, might)
