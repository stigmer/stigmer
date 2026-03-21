# Website Standards Reminder and Role Updates

**Date**: March 21, 2026

## Summary

Created a new quick-reference reminder for website standards and updated three roles (Growth Marketing Strategist, Sales Website Designer, Developer Copywriter) to reference the standards infrastructure built in Phases 1-6. This connects the existing roles and reminders to the machine-enforceable standards, templates, and Cursor rules — turning prose principles into operational guardrails.

## Problem Statement

Phases 1-6 of the sales-website-foundation project produced comprehensive standards infrastructure: 5 standards files, 17 templates, and 3 Cursor rules. But the reminders and roles that the AI loads in every session had no awareness these artifacts existed. Roles 007/008/009 described principles in prose without pointing to any enforceable standards. There was no quick-reference reminder for website standards (unlike `004_documentation-standards.md` for docs).

### Pain Points

- Roles described quality bar in prose but didn't reference concrete, machine-readable standards
- No reminder equivalent of `004_documentation-standards.md` existed for `site/` work
- Standards artifacts (JSON files, templates, Cursor rules) were invisible to AI sessions unless explicitly dragged into context
- Role mandates were aspirational ("we need an IA") rather than operational ("follow the IA at this path")

## Solution

Created a new reminder and updated three roles to wire everything together — the standards infrastructure from Phases 1-6 is now discoverable through the documents the AI loads in every session.

## Implementation Details

### New: `_reminders/008_website-standards.md` (83 lines)

Modeled on `004_documentation-standards.md`. Contains:
- Audience section with 3 personas
- Reference Documents table (5 standards files)
- Cursor Rules table (3 rules)
- Templates reference (9 page + 8 section)
- Condensed 7 mandates
- Content Brief process reference
- Quality checklist (10 items)

### Updated: `_roles/007_growth_marketing_strategist.md`

- Added REFERENCE DOCUMENTS section after DOMAIN CONTEXT
- Strengthened mandate #6 (Content Architecture): shifted from "we need an IA" to "follow the IA at `information-architecture.md`"
- Connected Marketing Strategy Brief to `@write-website-content` Cursor rule

### Updated: `_roles/008_sales_website_designer.md`

- Added REFERENCE DOCUMENTS section after DOMAIN CONTEXT
- Strengthened mandate #5 (Performance Is Design): replaced inline hardcoded targets with reference to `performance-budget.json` as single source of truth
- Strengthened mandate #8 (Component System): referenced `site/standards/templates/` for section structure patterns
- Connected Design Brief to both Cursor rules

### Updated: `_roles/009_developer_copywriter.md`

- Added REFERENCE DOCUMENTS section after DOMAIN CONTEXT
- Strengthened mandate #2 (Developer Authenticity): replaced inline banned phrases list with reference to `copy-guidelines.json` (16 phrases with reasons and replacements)
- Strengthened quality standard #3 (Testing Copy): added `copy-guidelines.json` sales terminology alongside `terminology.json`
- Connected Copy Brief to `@write-website-content` Cursor rule

## Benefits

- Every AI session working on `site/` now automatically discovers the standards infrastructure through roles and reminders
- Roles shift from aspirational principles to operational references — they point to concrete, machine-enforceable standards
- Single source of truth is established: numeric targets in JSON files, not duplicated across roles
- The pattern from docs (reminder 004 + Cursor rules + standards files) is now replicated for the sales website

## Impact

- **Roles 007, 008, 009**: Now reference all standards artifacts and Cursor rules. Any session using these roles immediately has access to the full standards infrastructure.
- **New sessions**: AI working on `site/` files gets standards context through the auto-apply Cursor rule, and can use `@write-website-content` / `@review-website-content` for active enforcement.
- **Project progress**: Phase 7 of 8 complete. Remaining: Phase 5 (Component Standards) and Phase 8 (Lint Tooling).

## Related Work

- Phase 1-4: Standards documents, IA, JSON files, templates (prior sessions)
- Phase 6: Cursor rules for enforcement (prior session)
- Phase 5 (upcoming): Component standards
- Phase 8 (upcoming): Lint tooling

---

**Status**: ✅ Production Ready
**Timeline**: ~30 minutes (1 new file, 3 updated files)
