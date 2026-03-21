# Review: T01_0_plan.md

**Date**: 2026-03-21
**Reviewer**: Suresh

## Feedback

### Roles: Three, not two

1. **Content Designer** — like the UX designer (006) but for docs/site. Decides how things should look visually. Replaces 008_sales_website_designer.
2. **Content Author** — writes the content that goes into components. Replaces 002_document_writer, 007_growth_marketing_strategist, 009_developer_copywriter.
3. **Content Engineer** — like web UX/UI (004) but for docs/site. Builds the actual components, ensures everything is componentized. The implementation role.

Console roles (004_web_ux_ui, 006_ux_designer) stay untouched.

### Reminders: Delete ALL of them

The reminder system is being removed entirely. Instead, provide two short text snippets that get pasted into every content conversation:

1. **Context snippet** — what Stigmer content is about, audience, quality bar (equivalent to the "platform for platforms" snippet used for console work)
2. **Motivation snippet** — "don't get complacent, bring your best work" adapted for content (equivalent to the collaboration/quality snippet used for console work)

These are NOT files in `_reminders/`. They're text the user copies and pastes.

### Rules: Clean up everything

User never uses rules. Only keep if there's a real auto-enforcement constraint. Otherwise delete.

### Templates: Delete everything

Replace with actual components. Every content type should have a component.

### Phase 2 scope

Build components for EVERY content type — not just a handful. Every template that existed should become a real component.

### Phase 3 approach

Content should be fed INTO components. The component takes the content as input. Not markdown with components sprinkled in — components that receive content.

### Framework must be AI-friendly

The component structure must be clear enough that AI knows exactly what to modify. AI should not need to invent structure — the framework tells it what goes where.
