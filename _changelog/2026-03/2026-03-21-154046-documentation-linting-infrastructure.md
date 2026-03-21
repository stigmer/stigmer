# Documentation Linting Infrastructure

**Date**: March 21, 2026

## Summary

Established automated documentation linting for the Stigmer monorepo, combining markdownlint-cli2 for markdown structure/style enforcement with a custom Node.js linter for Stigmer-specific rules (terminology, frontmatter schema, H1-title consistency, relative link validation). Integrated into the CI gate via `make check`.

## Problem Statement

Phases 1-3 of the documentation foundation project created standards, templates, a terminology dictionary, Fumadocs framework integration, and Cursor rules — but there was no automated enforcement at the CI level. A contributor could merge documentation that violates frontmatter requirements, uses prohibited terminology, has broken internal links, or skips heading levels, and no tool would catch it.

### Pain Points

- No CI-level enforcement of documentation standards
- Terminology violations (e.g., "agent run" instead of "AgentExecution") could slip through human review
- Missing frontmatter fields (`title`, `description`) would break search and meta tags
- Broken relative links between docs would go undetected until readers hit 404s
- No way to audit the ~114 pre-existing docs against the new standards

## Solution

Two-layer linting approach: a standard markdown linter for structural rules, plus a custom script for Stigmer domain-specific checks. Both wired into the existing `make check` CI gate.

## Implementation Details

### markdownlint-cli2 Configuration (`.markdownlint-cli2.jsonc`)

Rules derived from `docs/standards/documentation-standards.md`:
- MD001 (heading-increment): no skipped heading levels
- MD003 (heading-style): ATX-style `#` headings
- MD025 (single-h1): exactly one H1 per document, with `front_matter_title: ""` to prevent frontmatter `title:` from counting as an H1
- MD040 (fenced-code-language): every code block needs a language tag
- MD013 (line-length): disabled — prose docs wrap naturally
- MD033 (no-inline-html): disabled — MDX uses JSX components
- MD041 (first-line-heading): disabled — frontmatter precedes the first heading

Template files (`docs/standards/templates/`) are excluded since they contain intentional placeholder patterns.

### Custom Linter (`scripts/lint-docs.mjs`)

Four checks implemented:

1. **Terminology enforcement** — Reads `docs/standards/terminology.json`, scans prose (skipping fenced code blocks, frontmatter, and inline code), flags prohibited multi-word terms with file:line:column and the canonical replacement.

2. **Frontmatter validation** — Parses YAML frontmatter via `gray-matter`, verifies `title` and `description` are present and non-empty, checks description is 160 characters or fewer.

3. **H1-title match** — Verifies the single `# Heading` in the document body matches the `title` frontmatter field exactly.

4. **Relative link validation** — Extracts markdown links, resolves relative paths against the filesystem, tries common extensions (`.md`, `.mdx`, `index.md`, `index.mdx`), reports broken links.

### Terminology Scope Decision

Only multi-word prohibited terms are flagged automatically. Single-word terms ("server", "token", "module", "pipeline") have broad contextual exceptions that a line-level linter cannot resolve — "server" in "gRPC server" is a valid generic use, while "the server handles requests" when referring to StigmerServer is a violation. These require the human-readable context provided by the Cursor auto-apply rule.

### Makefile Targets

- `make lint-docs` — strict mode, MDX files only, fails on any error (CI gate)
- `make fix-docs` — auto-fix markdownlint issues (trailing spaces, heading style)
- `make lint-docs-audit` — all docs (md + mdx), non-blocking report for content migration

## Benefits

- Every future `.mdx` document is validated at the CI level before merge
- Prohibited terminology like "agent run", "tool connector", "chat session" is caught automatically
- Missing frontmatter, broken links, and heading violations are caught before they reach production
- The audit tool (`make lint-docs-audit`) provides a baseline of 377 issues across 114 legacy files, giving the content migration project a ready-made work list
- Auto-fix support (`make fix-docs`) reduces friction for contributors

## Impact

- **Documentation quality**: Automated enforcement ensures consistency across all new documentation
- **Content migration**: The audit baseline (377 issues / 114 files) scopes the migration project precisely
- **CI gate**: `make check` now includes `lint-docs`, blocking non-compliant docs from merging
- **Developer experience**: `make lint-docs` runs in ~1.4 seconds — fast enough for local iteration

## Related Work

- [Documentation Standards and Reminders](2026-03-21-135824-documentation-standards-and-reminders.md) — Phase 1 standards
- [Fumadocs Framework Integration](2026-03-21-145834-fumadocs-framework-integration.md) — Phase 2 framework
- [Documentation Cursor Rules](2026-03-21-151601-documentation-cursor-rules.md) — Phase 3 cursor rules

---

**Status**: ✅ Production Ready
**Timeline**: Phase 4 of the documentation foundation project
