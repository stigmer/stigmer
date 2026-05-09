# Skill Editor with Live Preview (Phase 3 T04-C)

**Date**: May 9, 2026

## Summary

Built a split-pane Skill editor in `@stigmer/react` that lets users create and edit single-file skills (SKILL.md) from the web console with a live Markdown preview. The editor constructs a valid Anthropic Agent Skills spec package, ZIPs it in the browser, and pushes via the existing `skill.push` RPC — no backend changes required.

## Problem Statement

Skills could only be created through the CLI (`stigmer push skill`) or as execution artifacts. There was no form-based creation or visual editing experience in the Console for users who want to author knowledge-document skills (brand guidelines, coding standards, workflow procedures) without leaving the browser.

### Pain Points

- Content authors forced to use CLI for simple SKILL.md-only skills
- No visual feedback while writing Markdown instructions
- No validation of Anthropic spec constraints (name format, description length) until push time
- "Create skill" button routed to a draft chat session, not a purpose-built editor

## Solution

SDK-first implementation of a Skill editor that serves the "content author" persona (80% case) while acknowledging that complex multi-file skill packages remain a CLI/Git concern.

**Architecture (3 layers):**
1. `useSkillEditor` — behavior hook (content state, metadata, dirty tracking, frontmatter serialization, validation)
2. `usePushSkill` — mutation hook (dynamic fflate import, ZIP packaging, push RPC call)
3. `SkillEditor` — styled component (metadata form, formatting toolbar, textarea editor, live preview)

## Implementation Details

**New SDK modules (`@stigmer/react`):**
- `sdk/react/src/skill/useSkillEditor.ts` — frontmatter parsing/serialization, Anthropic spec validation (name: lowercase+hyphens, max 64 chars; description: max 1024 chars), dirty tracking, round-trip safety for unknown frontmatter fields
- `sdk/react/src/skill/usePushSkill.ts` — dynamic `import('fflate')` for zero-cost lazy loading, packages SKILL.md into a single-entry ZIP, calls `stigmer.skill.push()`
- `sdk/react/src/skill/SkillEditor.tsx` — split-pane layout (editor | preview), metadata form, formatting toolbar (Bold/Italic/Heading/Code/Link/List), keyboard shortcuts (Cmd+B/I/S, Tab/Shift+Tab), 250ms debounced preview with `startTransition`, responsive (stacked on mobile)

**Console integration (`client-apps/web`):**
- `/library/skills/new` route → `SkillNewPage` (create mode)
- `/library/skills/[org]/[slug]/edit` route → `SkillEditPage` (edit mode, loads existing skill and parses frontmatter)
- `SkillListPage` "Create skill" button now routes to `/library/skills/new`
- `SkillDetailPage` gains an "Edit" primary action button

**New dependency:** `fflate ^0.8.2` (MIT, ~13KB gzip) — browser-side ZIP creation, dynamically imported only when push is called.

## Benefits

- Content authors can create and edit simple skills entirely from the browser
- Live preview uses the same rendering pipeline as `SkillDetailView` — WYSIWYG fidelity
- Platform builders get headless hooks (`useSkillEditor`, `usePushSkill`) for custom editor UIs
- Anthropic spec validation catches errors before push (name format, length limits)
- Zero backend changes — uses existing `push` RPC correctly with browser-side ZIP packaging
- fflate is dynamically imported — zero bundle cost for consumers who only read skills

## Impact

- Users: New skill creation flow from web console (previously CLI-only for content authors)
- Platform builders: New public SDK exports for skill creation/editing in embedded contexts
- SDK surface: 6 new public exports (2 hooks, 1 component, 3 utility functions + types)

## Related Work

- Phase 3 T04-A: ResourceWorkbench creation slot (entry point)
- Phase 3 T04-B: Agent Creation Wizard (shared patterns)
- Phase 3 T04-E: YAML/JSON Import/Export

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
