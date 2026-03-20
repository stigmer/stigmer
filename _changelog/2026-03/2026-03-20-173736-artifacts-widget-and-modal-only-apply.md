# ArtifactsWidget Component and Modal-Only Apply Pattern

**Date**: March 20, 2026

## Summary

Added the `ArtifactsWidget` container component to `@stigmer/react` and simplified `ArtifactCard` by moving the Apply/Push CTA exclusively to `ArtifactPreviewModal`. This completes Phase 2 of the Library and Artifacts Flow project — the full artifact detection, preview, and apply pipeline is now wired end-to-end from the SDK to the Console's session right sidebar.

## Problem Statement

The execution artifacts infrastructure (hooks, detection, apply logic) was complete (T02.1–T02.5), but there was no container component to compose the individual `ArtifactCard` instances with the `ArtifactPreviewModal`, and no integration into the Console's session page. Additionally, both `ArtifactCard` and `ArtifactPreviewModal` independently managed their own Apply state via separate `useApplyResource` hooks, creating a state synchronization problem.

### Pain Points

- No way to view execution artifacts in the Console — the hooks and components existed but weren't composed or wired in
- `ArtifactCard` and `ArtifactPreviewModal` each had independent apply state — if a user applied via the modal and closed it, the card still showed "Apply" (UX desync)
- `ArtifactCard` was overly complex for a sidebar card — 508 lines with 4 hooks, an internal state machine, and 6 SVG icons for a component that should signal and navigate

## Solution

Two changes working together:

1. **Modal-only Apply (DD-008)**: Removed the Apply CTA from `ArtifactCard` entirely. The card's role is now purely signal-and-navigate: show detection badges, offer Preview and Download. The `ArtifactPreviewModal` is the sole location for Apply/Push — the user must review the artifact content before acting. This eliminates the state sync problem by design rather than by coordination.

2. **ArtifactsWidget**: A new container component that composes `ArtifactCard` list with `ArtifactPreviewModal` orchestration. Takes an `execution` object and derives everything internally (artifacts, terminal phase, execution ID), matching the established `ExecutionProgress`/`ExecutionCostSummary` prop pattern.

## Implementation Details

### ArtifactCard Simplification

Removed from `sdk/react/src/execution/ArtifactCard.tsx`:
- `useApplyResource` hook call and `ApplyResourceResult` import
- `isTerminal` and `onApplied` props
- `ApplyCtaArea` internal component (apply state machine: idle → applying → applied → error)
- `useState`, `useCallback` imports (no longer needed)
- 3 SVG icons (CheckIcon, SpinnerIcon, AlertIcon)

Result: 508 lines → 276 lines. Props reduced from 7 to 5. Internal hooks reduced from 4 to 3.

### ArtifactsWidget (`sdk/react/src/execution/ArtifactsWidget.tsx`)

- Props: `execution: AgentExecution | null`, `org: string`, `onApplied?`, `className?`
- Internal derivation: `useExecutionArtifacts(execution)` + `isTerminalPhase(phase)` + `execution.metadata.id`
- Single state: `previewArtifact: ExecutionArtifact | null` — drives modal open/close
- Returns `null` when no artifacts (conditional-render pattern)
- Renders: section header with count badge → `role="list"` card stack → controlled `ArtifactPreviewModal`
- 128 lines, full JSDoc with `@example` and `@see` cross-references

### SessionPage Integration

Added `ArtifactsWidget` to the right sidebar `<aside>` in `client-apps/web/src/app/sessions/[id]/SessionPage.tsx`, below `ExecutionCostSummary`. No wrapper div needed — each `ArtifactCard` has its own visual chrome, and the sidebar `gap-3` handles spacing.

## Benefits

- **State consistency**: No more desync between card and modal — the card doesn't manage apply state at all
- **Review-before-apply**: Users must see artifact content before applying, preventing blind application of AI-generated resources
- **Simpler SDK surface**: `ArtifactCard` is now a lightweight, predictable component that platform builders can embed without worrying about apply side effects
- **Phase 2 complete**: Full artifact pipeline from proto → backend → SDK hooks → styled components → Console integration

## Impact

- **Platform builders**: `ArtifactsWidget` is a drop-in component for any execution monitoring UI. Compose with `useExecutionStream` and it just works.
- **Console users**: Artifacts now appear in the session right sidebar automatically when an execution produces them, with detection badges and preview/download actions.
- **SDK API surface**: 1 new export (`ArtifactsWidget`), 2 props removed from `ArtifactCard` (`isTerminal`, `onApplied`). The prop removal is intentional — the Apply flow belongs to the modal, not the card.

## Related Work

- Phase 1: Library pages and navigation (T01.1–T01.13) — completed in sessions 1–12
- Phase 2: Execution artifacts pipeline (T02.1–T02.5) — completed in sessions 13–19
- This session (T02.6–T02.8) completes Phase 2
- Phase 3: "Create New" draft flow (T03.1–T03.3) — next

---

**Status**: ✅ Production Ready
**Timeline**: Single session
