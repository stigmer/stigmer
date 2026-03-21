# Docs enforcement backbone: auto-apply rule strengthened

**Date**: March 21, 2026

## Summary

Strengthened the `documentation-standards.mdc` auto-apply Cursor rule to serve as the enforcement backbone for all documentation work. Critical audience context, Diataxis framework mapping, and the Doc Blueprint process gate — previously only available when manually dragging reminders into chat — now fire automatically whenever any `docs/**` file is touched in a conversation.

## Problem statement

The documentation project had well-defined standards across multiple layers (Cursor rules, reminders, reference files), but a fresh conversation starting docs work would miss the most important enforcement context. The auto-apply rule was a thin summary pointing to other files without ensuring they were actually read.

### Pain points

- Starting a fresh docs conversation required manually dragging reminders 004 and 007 into chat
- The auto-apply rule summarized standards but didn't inline the audience definition or writing process gates
- The AI could write docs without knowing the reader is a platform builder evaluating alternatives
- No automatic enforcement of the Doc Blueprint process (content type, audience audit, gap analysis, outline)

## Solution

Inlined the critical content from reminders 004 (`documentation-standards`) and 007 (`documentation-for-platform-builders`) directly into the `documentation-standards.mdc` auto-apply rule, which fires on `docs/**/*.md` and `docs/**/*.mdx` glob patterns.

## Implementation details

Updated `.cursor/rules/docs/documentation-standards.mdc` with:

- **Full audience definition** — platform builder profile (technically skilled, new to Stigmer, evaluating alternatives, time-constrained, integration-focused) and time-to-value as the north star
- **Diataxis framework** — quadrant mapping table and the rule against mixing quadrants
- **"Before writing" gate** — three questions to ask, required reading list (terminology.json, template, information-architecture.md), Doc Blueprint process steps, quality checklist
- **Five mandates** — ubiquitous language, eliminate assumptions, active voice, structural hierarchy, analogies
- **Reference documents section** — clear pointers to the full standards files for details beyond the inlined content

The rule grew from ~130 lines to ~210 lines — still within a reasonable size for an auto-apply rule while being self-sufficient for enforcement.

## Benefits

- Fresh docs conversations get full enforcement context automatically — no manual setup
- Reminders 004 and 007 no longer need to be dragged into docs-focused chats
- The Doc Blueprint and quality review processes are surfaced in every docs conversation
- Consistent documentation quality regardless of which chat session creates the content

## Impact

- **Docs workflow**: Two fewer manual steps when starting docs work
- **Quality enforcement**: Standards that were previously opt-in (drag reminders) are now automatic
- **Onboarding**: Any contributor starting a docs conversation gets the full context without knowing about reminders

---

**Status**: ✅ Production Ready
