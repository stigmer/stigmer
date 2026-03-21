# Docs: Audience & Purpose Foundation (Phase 0)

**Date**: March 21, 2026

## Summary

Established the audience and purpose foundation for Stigmer documentation by defining platform builders as the primary audience, adopting the Diataxis framework as the organizing principle, and adding content validation mandates. This is Phase 0 of the docs clean slate rebuild — the mindset foundation that every subsequent phase depends on.

## Problem Statement

The documentation infrastructure had well-defined formatting standards (templates, headings, terminology, linting) but never defined *who* the documentation is for or *why* it exists. The document writer role targeted "developers, platform operators, and AI practitioners" — too vague to drive editorial decisions. The standards jumped straight to formatting mandates with no audience context.

### Pain Points

- No reminder or standard defined the documentation audience
- `_reminders/003_platform-for-platforms.md` covers UI/SDK code, not documentation
- `_reminders/005_sales-website-mindset.md` explicitly excludes docs
- The document writer role had a generic audience definition
- Standards permitted ASCII art alongside Mermaid — inconsistent for a clean rebuild
- No rule required content validation against the actual codebase

## Solution

Created a new audience mindset reminder and updated four existing files to embed platform builder focus, the Diataxis framework, time-to-value as the north star, and content validation mandates throughout the documentation governance layer.

## Implementation Details

**New file**: `_reminders/007_documentation-for-platform-builders.md`
- Defines the primary reader: a platform builder embedding Stigmer's AI agent execution into their product
- Characterizes reader constraints: technically skilled, new to Stigmer, evaluating alternatives, time-constrained
- Maps content to the Diataxis framework (Tutorials, How-to Guides, Reference, Explanation)
- Establishes time-to-value as the primary metric: zero to running agents in 5 minutes
- Adds content validation rules: protos are source of truth, CLI examples must be tested, no legacy trust

**Updated**: `docs/standards/documentation-standards.md`
- Added "Audience & Purpose" as the first section before the five mandates
- Changed Diagrams section from allowing ASCII art to Mermaid-only

**Updated**: `_reminders/004_documentation-standards.md`
- Added audience context at the top with cross-reference to reminder 007

**Updated**: `_roles/002_document_writer.md`
- Replaced generic audience with explicit platform builder focus
- Strengthened audience audit step with Diataxis quadrant identification
- Added time-to-value bullet to quality philosophy

**Updated**: `.cursor/rules/docs/documentation-standards.mdc`
- Added Audience section with platform builder definition and Diataxis reference
- Strengthened Diagrams to Mermaid-only
- Added Content Validation section

## Benefits

- Every documentation conversation now has a clear audience lens — platform builders first
- The Diataxis framework provides a shared vocabulary for content types (Tutorial vs How-to vs Reference vs Explanation)
- Content validation mandate prevents the stale documentation problem that motivated the clean slate rebuild
- Mermaid-only diagram standard ensures visual consistency across all new docs

## Impact

- Affects all future documentation work in `docs/`
- Sets the editorial direction for Phases 1-5 of the docs rebuild
- Auto-injected via cursor rule on every `docs/**/*.{md,mdx}` edit

## Related Work

- Part of project `20260321.03.docs-content-migration`
- Phase 1 (Clean Slate + Visual Foundation) is next
- Plan: `_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md`

---

**Status**: ✅ Production Ready
**Timeline**: Phase 0 of 6
