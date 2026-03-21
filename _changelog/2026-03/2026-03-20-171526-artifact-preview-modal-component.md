# ArtifactPreviewModal Component

**Date**: March 20, 2026

## Summary

Added `ArtifactPreviewModal` to `@stigmer/react` — a self-contained SDK component that renders a full preview of execution artifacts with content display, Stigmer resource detection, and Apply/Push CTA. Uses the native `<dialog>` element for zero-dependency modal behavior, and CSS-only YAML highlighting to avoid adding bundle weight to the SDK.

## Problem Statement

The `ArtifactCard` component (T02.4) provides a compact summary of artifacts in the right sidebar, but users need a way to review the full content before applying a detected resource to their organization. The original plan (DD-005) identified a modal as the correct UX pattern for this decision gate: the user pauses, inspects the full YAML, and decides to Apply, Download, or Close.

### Pain Points

- No way to preview artifact content beyond the card's detection badge
- Users must download and open files externally to review content before applying
- Directory artifacts (skill packages) have no way to inspect the file listing

## Solution

A layer 3 styled SDK component that manages its own hooks internally (same self-contained pattern as `ArtifactCard`), with two content modes for FILE and DIRECTORY artifacts.

Key architectural decisions:

- **Native `<dialog>`** over `@base-ui/react/dialog` — zero dependency, built-in focus trap / top-layer / Escape handling, no z-index conflicts with host apps
- **CSS-only YAML highlighting** over `react-syntax-highlighter` — keys colored via `text-primary`, comments via `text-muted-foreground italic`, document separators and multi-line indicators muted. Covers 90% of YAML readability at ~50 lines instead of 50KB+ bundle cost
- **Self-contained hook orchestration** — `useArtifactContent` + `useDetectStigmerResource` (FILE) or `useDetectSkillPackage` (DIRECTORY) + `useApplyResource`, all gated on the `open` prop to avoid fetching when hidden

## Implementation Details

**New file**: `sdk/react/src/execution/ArtifactPreviewModal.tsx` (~590 lines)

**Two content modes**:

- **FILE artifacts**: Scrollable `<pre><code>` with CSS-only YAML highlighting, truncation notice when server-limited, loading skeleton, error state
- **DIRECTORY artifacts**: Skill metadata card (name + description from detection) + flat file listing from `artifact.entries`

**Action bar**: Copy (file artifacts, `navigator.clipboard.writeText()` with 2s ARIA-announced feedback), Download (`<a download>`), Apply/Push (idle → applying → applied → error state machine, enabled only when `isTerminal`)

**Internal sub-components**: `ModalHeader`, `FileContentView`, `DirectoryContentView`, `ActionBar`, `ApplyButton`, plus `highlightYaml` / `highlightYamlLine` / `highlightYamlValue` pure functions and 10 inline SVG icons

**Accessibility**: Native `showModal()` focus trap, Escape via `onCancel`, `aria-label` on dialog, `aria-busy` on loading, `role="alert"` on errors, `role="status"` ARIA live region for copy feedback, `focus-visible` rings on all interactive elements

## Benefits

- Platform builders get a drop-in preview modal with 6 required props
- Zero new dependencies — native `<dialog>` + CSS highlighting keeps the SDK lean
- Headless hooks remain available for builders who want their own preview UI
- Consistent detection/apply pipeline with `ArtifactCard` (same hooks, same UX)
- Theme-respecting highlighting adapts to dark mode and host app's `--stgm-*` tokens

## Impact

- **SDK consumers**: New `ArtifactPreviewModal` and `ArtifactPreviewModalProps` exported from `@stigmer/react`
- **Console**: Ready for integration in T02.6 (`ArtifactsWidget`) and T02.8 (`SessionPage`)
- **Existing exports**: All unchanged — no breaking changes

## Related Work

- T02.4 `ArtifactCard` component (triggers preview via `onPreview` callback)
- T02.1 `useArtifactContent` / `useExecutionArtifacts` data hooks
- T02.2 `useDetectStigmerResource` / `useDetectSkillPackage` detection hooks
- T02.3 `useApplyResource` behavior hook
- DD-005 Modal for artifact preview (design decision)

---

**Status**: ✅ Production Ready
**Timeline**: Session 19 (T02.5)
