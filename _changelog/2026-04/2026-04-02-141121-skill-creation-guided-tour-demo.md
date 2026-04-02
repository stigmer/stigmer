# Skill Creation Guided Tour Demo Component

**Date**: April 2, 2026

## Summary

Replaced the static `DemoSkillCreation` MessageThread on the "Your first Skill"
docs page with an animated guided-tour component that walks readers through the
full Stigmer web app navigation flow: sidebar click, skills list, create skill,
session composer, and conversation playback. The component reuses the existing
`ScenarioPlayer` engine and real `@stigmer/react` components for the
conversation portion.

## Problem Statement

The "Your first Skill" tutorial tells readers to navigate the web app —
Library, Skills, Create Skill, Session Composer — but only showed a static
`MessageThread` of the finished conversation. Readers had to imagine the
navigation steps described in the text.

### Pain Points

- No visual bridge between the textual navigation instructions and the
  conversation demo
- Readers unfamiliar with the Stigmer web app had no visual reference for the
  sidebar, skills list, or session composer
- The existing `skillCreationExecution` fixture had a duplicate-message bug
  (first human message rendered twice due to `spec.message` / `status.messages`
  overlap)

## Solution

Built a multi-step guided-tour component using a discriminated union data model
(`GuidedTourStep`) orchestrated by the existing `ScenarioPlayer<T>` engine.
Each step renders a different view inside a shared `DemoAppShell` wrapper:
sidebar with navigation highlights, a mock skills list with pulse effects,
and a session composer with real `MessageThread` rendering.

## Implementation Details

### New files (5)

| File | Purpose |
|------|---------|
| `scenarios/skill-creation-tour.ts` | `GuidedTourStep` type, 8-step sequence, `snapshot()` helper |
| `DemoAppShell.tsx` | Schematic sidebar + content area layout |
| `SkillsListView.tsx` | Mock skills list with "Create Skill" button |
| `ComposerView.tsx` | Agent header + `MessageThread` from `@stigmer/react` |
| `DemoSkillCreationTour.tsx` | Top-level component with `ScenarioPlayer` wiring |

### Key patterns

- **Discriminated union**: `GuidedTourStep` has variants for each view
  (`library-click`, `skills-list`, `create-skill-click`, `composer-ready`,
  `conversation`), enabling type-safe rendering dispatch
- **Content key grouping**: Fade transitions only fire when the view
  *category* changes (`"dashboard"` / `"skills"` / `"composer"`), not on
  every message snapshot
- **Snapshot helper**: Fixes the duplicate-message bug by placing the first
  human message in `spec.message` and excluding it from `status.messages`
- **Pulse animation**: `framer-motion` opacity animation on highlighted nav
  items and buttons (accessible, respects reduced motion)

### Integration

- Replaced `DemoSkillCreation` import/usage in `first-skill.mdx` with
  `DemoSkillCreationTour`
- Updated barrel export (`index.ts`) and global MDX registration (`mdx.tsx`)

## Benefits

- Readers see the full navigation flow animated on the docs page
- Real `@stigmer/react` MessageThread used for conversation — not a mockup
- Reuses existing `ScenarioPlayer` engine — no new orchestration code
- Representative styling matches docs theme, low maintenance (not a console replica)
- Duplicate-message bug fixed

## Impact

- **Docs site**: "Your first Skill" page now has a richer, more informative demo
- **No SDK changes**: All new code is docs-specific (`site/src/components/docs/demos/`)
- **No breaking changes**: Old `DemoSkillCreation.tsx` kept in repo but no
  longer exported

## Related Work

- Parent project: `_projects/2026-04/20260401.02.sp.getting-started-revision/`
- ScenarioPlayer prototype: `_changelog/2026-04/2026-04-02-102646-session-2-scenario-player-prototype.md`
- Phase 3 Getting Started docs: `_changelog/2026-04/2026-04-01-171833-phase-3-getting-started-documentation.md`

---

**Status**: ✅ Production Ready (pending visual QA)
**Timeline**: Single session
