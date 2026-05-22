# Workflow Screens: Parity with Agent UI

**Date**: May 19, 2026

## Summary

Brought workflow list and detail pages to full parity with the recently improved agent screens. Workflows now default to card/grid view, support inline editing for description and environment variables, have visibility controls and export actions, and are covered by Playwright e2e tests that enforce cross-resource UI consistency.

## Problem Statement

The agent screens had been recently improved with card/grid default view, inline editing, visibility toggles, export actions, and a polished detail page. Workflow screens were left behind with a flat table list, no inline editing, no export actions, and a cluttered overview tab that led with internal "Document" metadata instead of the user-facing description.

### Pain Points

- Workflow list defaulted to table view while agents defaulted to cards -- inconsistent visual language
- Workflow detail page had no inline editing capability (agents had `editable` prop with `InlineEditTextarea`, `InlineEditKeyValue`, etc.)
- No export actions (Export YAML/JSON, Download YAML) on workflow detail -- agents had all of these
- No visibility toggle on workflow detail page
- Overview tab led with "Document" section (DSL version, namespace) instead of description
- No Import button on the workflow list header
- Zero Playwright e2e test coverage for workflow-specific UI flows
- No cross-resource consistency tests ensuring agents and workflows stay aligned

## Solution

SDK-first implementation following DD-001 (build in `@stigmer/react` first, consume from client-apps second):

1. **SDK layer**: Added `editable`, `onVisibilityChange`, `isVisibilityPending`, and `onResourceUpdated` props to `WorkflowDetailView`. Created `useUpdateWorkflow` hook and `workflowToInput` converter. Wired `InlineEditTextarea` for description and `InlineEditKeyValue` for environment variables.

2. **Client-app layer**: Updated `WorkflowListPage` to default to cards with Import + Create header actions. Updated `WorkflowDetailPage` to wire `useExportResource`, `useUpdateVisibility`, full action set, and `editable` prop.

3. **Test layer**: Extended smoke tests, created 3 new Playwright spec files covering workflow list, workflow detail, and cross-resource consistency.

## Implementation Details

### New SDK Files
- `sdk/react/src/workflow/useUpdateWorkflow.ts` -- Mutation hook wrapping `stigmer.workflow.update()` with loading/error state, mirroring `useUpdateAgent`
- `sdk/react/src/workflow/internal/workflowToInput.ts` -- Converts fetched `Workflow` proto back to `WorkflowInput` for field-level inline edits, mirroring `agentToInput`

### Modified SDK Files
- `sdk/react/src/workflow/WorkflowDetailView.tsx` -- Major expansion: editable props, visibility toggle, inline edit components, reordered overview sections (Description first, Document last as compact metadata strip), workflow icon in header and not-found state
- `sdk/react/src/workflow/index.ts` -- Exported new hook and converter

### Modified Client-App Files
- `client-apps/web/src/domain/workflow/WorkflowListPage.tsx` -- Cards default, Import + Create header, empty state CTA, `ImportResourceDialog`
- `client-apps/web/src/domain/workflow/WorkflowDetailPage.tsx` -- `useExportResource`, `useUpdateVisibility`, full 6-action kebab menu, `editable` and visibility props

### New Playwright Tests
- `test/e2e/tests/functional/workflow-list.spec.ts` -- 7 tests: heading, search, card default, view toggle, Create/Import buttons, empty state
- `test/e2e/tests/functional/workflow-detail.spec.ts` -- 6 tests: tabs present, overview structure, tab switching, action menu, Run button
- `test/e2e/tests/functional/library-consistency.spec.ts` -- 5 parameterized tests: heading/search/workbench parity, card default, Create button presence

### Extended Smoke Tests
- `test/e2e/tests/smoke/library.spec.ts` -- Added workbench visibility checks for both agents and workflows

## Benefits

- **Consistent user experience**: Both agents and workflows now share identical interaction patterns -- card lists, inline editing, export actions, visibility controls
- **Reduced cognitive load**: Users learn one pattern for resource management, not two
- **Regression safety**: 18+ new Playwright test assertions prevent future UI drift between agents and workflows
- **SDK completeness**: Platform builders embedding `WorkflowDetailView` now get the same feature set as `AgentDetailView`

## Impact

- **Direct users**: Workflow management now matches the polished agent experience
- **Platform builders**: `WorkflowDetailView` gains `editable`, `onVisibilityChange`, and export-ready action support
- **Quality**: Cross-resource consistency is now enforced by automated tests

---

**Status**: ✅ Production Ready
