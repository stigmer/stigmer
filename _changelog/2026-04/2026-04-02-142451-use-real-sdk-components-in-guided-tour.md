# Use Real SDK Components in Guided Tour Demo

**Date**: April 2, 2026

## Summary

Replaced custom illustrative components in the skill-creation guided-tour demo
with real `@stigmer/react` SDK components. `SkillsListView` now uses
`ResourceListView` with fixture data, and `ComposerView` uses the real
`SessionComposer` for its empty state. All demo views now render production
SDK components backed by fixture data.

## Problem Statement

The initial guided-tour implementation built custom card divs and a fake text
input to approximate the skills list and session composer. This violated the
embedded component standard: "use real @stigmer/react components backed by demo
fixtures — never static screenshots or mockups."

### Pain Points

- Custom skill cards used `lucide-react` `FileText` icons instead of the SDK's
  built-in `KindIcon` which renders the correct icon per `ApiResourceKind`
- Fake text input div did not match the real `SessionComposer` appearance
- Inconsistency between the conversation portion (real `MessageThread`) and
  the list/composer portions (custom fakes)

## Solution

Replaced both custom implementations with their SDK equivalents, using the
minimal-props pattern that disables features requiring live API calls.

## Implementation Details

### SkillsListView

- Replaced custom card `map()` with `<ResourceListView items={MOCK_SKILLS} isLoading={false} />`
- Mock data built via `samples.searchResult()` with `kind: ApiResourceKind.skill`
- Page header ("Skills") and "Create Skill" button with pulse animation
  retained as wrapper chrome — `ResourceListView` correctly excludes page-level
  actions
- Removed `FileText` import from `lucide-react`

### ComposerView

- Replaced fake text input with `<SessionComposer>` using:
  `showModelSelector={false}`, `enableAttachments={false}`, `initialRows={2}`,
  `autoFocus={false}`, `onSubmit={noop}`
- Agent header bar retained (no SDK component exists for this — correct per
  architecture, it's session page chrome)
- `MessageThread` for conversation steps unchanged (already real SDK)
- Removed `SendHorizontal` import from `lucide-react`

## Benefits

- All demo views now use production SDK components — consistent with the
  embedded component standard
- Readers see the exact same rendering the real Console shows
- Reduced custom code and `lucide-react` dependencies in demo files

## Impact

- 2 files changed (`SkillsListView.tsx`, `ComposerView.tsx`)
- No changes to orchestration (`DemoSkillCreationTour`, `DemoAppShell`,
  `skill-creation-tour.ts`, `ScenarioPlayer`)
- No SDK changes

## Related Work

- Previous session: `_changelog/2026-04/2026-04-02-141121-skill-creation-guided-tour-demo.md`

---

**Status**: ✅ Production Ready (pending visual QA)
**Timeline**: Single session follow-up
