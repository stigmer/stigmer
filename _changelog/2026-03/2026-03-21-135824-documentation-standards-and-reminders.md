# Documentation Standards, Templates, and Conversation Reminders

**Date**: March 21, 2026

## Summary

Established the documentation standards foundation for the Stigmer platform: a master standards document, 7 doc-type templates, a machine-readable terminology dictionary, an information architecture map, and a set of conversation reminders for consistent AI-assisted development. This is Phase 1 of the documentation foundation project — it defines the rules and patterns that all future documentation must follow.

## Problem Statement

Stigmer has 100+ markdown files in `docs/` with no formal standards, no templates, no terminology enforcement, and no framework rendering them as a documentation site. The existing `what-is-*.md` pattern is consistent but not formalized. The Document Writer role (`_roles/002_document_writer.md`) defines mandates but has no supporting infrastructure — no templates, no linter dictionary, no information architecture.

Separately, conversation reminders (plan-first, platform-for-platforms) were being manually typed into every Cursor conversation with no formalized, reusable files.

### Pain Points

- No formal documentation standards document — quality depends on whoever is writing
- No templates — each doc type is reinvented from memory
- No terminology dictionary — ubiquitous language violations are caught manually
- No information architecture — sidebar structure, URL scheme, and ordering are undefined
- No reusable conversation reminders — key context gets lost between sessions

## Solution

Created a complete standards infrastructure under `docs/standards/` and a conversation reminders system under `_reminders/`.

## Implementation Details

### Documentation Standards (`docs/standards/`)

**Master standards document** (`documentation-standards.md`) — 283 lines covering:
- Five mandates (ubiquitous language, eliminate assumptions, active voice, structural hierarchy, analogies)
- Content types taxonomy (7 types with purpose, audience, directory, and template)
- Frontmatter schema (required: `title`, `description`; optional: `sidebar_label`, `sidebar_position`, `tags`, `last_updated`)
- Heading hierarchy, code block, writing style, cross-referencing, and diagram rules
- Quality checklist for pre-merge validation

**Information architecture** (`information-architecture.md`) — Sidebar tree, URL scheme (`/docs/{type}/{slug}`), directory-to-route mapping (15 directories classified as rendered/excluded), and ordering conventions.

**Terminology dictionary** (`terminology.json`) — 23 canonical terms (Agent, AgentExecution, McpServer, Skill, Workflow, etc.) with prohibited aliases and contextual exceptions. Machine-readable for the Phase 4 terminology linter.

**Seven templates** (`templates/*.mdx`):
- `concept.mdx` — Formalizes the `what-is-*.md` pattern (positioning → summary → problem → solution → architecture → comparison → getting started → further reading)
- `quickstart.mdx` — 5-minute onboarding (prerequisites → steps → verify → what you built → next steps)
- `sdk-guide.mdx` — Language-specific topic guide (overview → basic example → patterns → errors → API reference)
- `how-to-guide.mdx` — Task-oriented guide (prerequisites → overview → steps → verify → troubleshooting)
- `cli-reference.mdx` — Man-page style (synopsis → description → arguments → flags → examples → exit codes)
- `architecture.mdx` — Design rationale (overview → problem → design with diagrams → decisions → trade-offs → implementation)
- `adr.mdx` — Decision record (status table → context → decision → consequences → alternatives)

### Conversation Reminders (`_reminders/`)

- `001_plan-first.md` — Forces planning before execution; defines what a plan must include
- `002_collaboration-principles.md` — Quality bar, collaboration over autonomy, pause on surprises
- `003_platform-for-platforms.md` — SDK-first architecture (non-negotiable layering, integration ergonomics, APIs as UX)
- `004_documentation-standards.md` — Points to standards, templates, terminology; summarizes the five mandates

## Benefits

- Every future document (human or AI-authored) has a template, a standard, and a checklist
- The terminology dictionary enables automated enforcement in Phase 4
- The information architecture provides a single source of truth for Phase 2's Fumadocs integration
- Conversation reminders eliminate the need to manually retype context in every session
- Templates reduce the cognitive load of authoring and reviewing documentation

## Impact

- **Documentation authors**: Clear templates and standards for every doc type
- **AI assistants**: Reminders and standards inject quality constraints into every conversation
- **Phase 2-5 of the project**: Standards, IA, and terminology are prerequisites that are now complete
- **Future content migration**: The ~100 existing docs have a clear target format to migrate toward

## Related Work

- Part of project `20260321.01.documentation-foundation` (Phase 1 of 5)
- Builds on `_roles/002_document_writer.md` mandates
- Enables Phase 2 (Fumadocs framework), Phase 4 (terminology linting)

---

**Status**: ✅ Production Ready
**Timeline**: Single session
