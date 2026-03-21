# Documentation Cursor Rules and Role Rewrite

**Date**: March 21, 2026

## Summary

Created three Cursor rules for automated documentation quality enforcement and rewrote the document writer role to eliminate content duplication. This completes Phase 3 of the documentation foundation project, establishing the workflow guardrails that ensure all future documentation is written and reviewed against Stigmer's formalized standards.

## Problem Statement

Phase 1 established documentation standards (mandates, templates, terminology) and Phase 2 integrated the Fumadocs rendering framework. But the standards only existed as reference documents — nothing enforced them during the authoring process.

### Pain Points

- The document writer role (`_roles/002_document_writer.md`) duplicated ~60% of the standards document verbatim, creating maintenance debt.
- No Cursor rules existed for documentation — unlike CLI code (which had `coding-guidelines.mdc` and `implement-stigmer-cli-features.mdc`), docs had no automated enforcement.
- The documentation reminder referenced the standards but couldn't invoke automated checks.
- No structured review process existed — quality checks were manual and inconsistent.

## Solution

Three Cursor rules organized in `.cursor/rules/docs/`, plus a rewritten role file and updated reminder. The rules follow the same pattern as the CLI domain: one auto-apply standards rule paired with action rules for specific workflows.

## Implementation Details

### New: `.cursor/rules/docs/documentation-standards.mdc` (Auto-apply)

Triggers on every `docs/**/*.{md,mdx}` edit. Contains the essential guardrails — content-type detection from file path, frontmatter requirements, heading hierarchy, terminology enforcement, writing style constraints, cross-referencing rules. Deliberately lean (110 lines) since it fires on every edit.

### New: `.cursor/rules/docs/write-documentation.mdc` (Action)

The "implement" rule invoked as `@write-documentation`. Enforces the Doc Blueprint process (content type, audience audit, gap analysis, outline, confirmation). Contains per-content-type template constraints for all 7 types (quickstart, concept, how-to, CLI reference, SDK guide, architecture, ADR). Includes Fumadocs patterns: `meta.json` ordering, `index.mdx` landing pages, URL slug conventions, static export requirements.

### New: `.cursor/rules/docs/review-documentation.mdc` (Action)

The quality gate invoked as `@review-documentation`. Contains a 25-item checklist across 6 categories: structure, terminology, code blocks, writing quality, cross-references, and information architecture compliance. Defines a structured review output format with pass/fail verdicts and specific fix instructions.

### Rewritten: `_roles/002_document_writer.md`

Cut from 127 to 62 lines. Removed all duplicated mandates, content types, frontmatter schema, and quality checklist. Now focuses on role identity, standards/rules references, framework awareness (Fumadocs, meta.json, static export), the Doc Blueprint process, quality philosophy, and response style. Zero content duplication with the standards document.

### Updated: `_reminders/004_documentation-standards.md`

Added Cursor Rules reference table showing activation modes. Added information architecture doc to the reference table. Tightened "Before Writing" to invoke `@write-documentation` and "Quality Checklist" to reference `@review-documentation`.

## Benefits

- Documentation standards are now enforced automatically during authoring, not just referenced manually.
- Single source of truth — standards live in `docs/standards/`, role defines persona/process, rules enforce. No duplication.
- Content-type-specific enforcement: the write rule detects the doc type from the file path and applies the correct template constraints.
- Structured review process with 25 specific checks and a defined output format.
- Follows the established CLI rules pattern, making the rule structure familiar across the codebase.

## Impact

- All future documentation work in `docs/` will have standards injected into context automatically.
- Writers using `@write-documentation` get template-specific guidance before they start drafting.
- Reviewers using `@review-documentation` get a comprehensive checklist instead of ad-hoc quality checks.
- The document writer role is now maintainable — changing standards only requires editing one file.

## Related Work

- Phase 1: Documentation standards, templates, terminology (`docs/standards/`)
- Phase 2: Fumadocs framework integration (`site/src/app/docs/`)
- Next: Phase 4 (Documentation linting — `markdownlint-cli2`, custom terminology linter, `make lint-docs`)
- Next: Phase 5 (Quickstart skeleton and content seeding)

---

**Status**: Production Ready
**Timeline**: Single session
