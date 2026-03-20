# DD-005: Modal for Artifact Preview

**Date**: 2026-03-20
**Status**: Decided
**Participants**: Developer + Architect

## Context

When a user clicks "Preview" on an artifact in the right sidebar widget, we need a way to show the full content. Options: modal, slide-over/drawer, inline expansion.

## Decision

Use a **modal** for artifact preview.

## Rationale

- Artifact preview is a **decision gate**: the user stops, reviews content, and decides (Apply, Download, or Close). Modals are the canonical UX pattern for decision gates.
- Nielsen's Heuristic #2 (Match between system and real world): a modal communicates "pause and pay attention to this decision"
- A slide-over/drawer would be better for **browsing** scenarios (exploring files, reading documentation) where persistent access to background context is needed. Artifact review is focused and terminal.
- Inline expansion doesn't work because the right sidebar is too narrow for YAML readability
- Simpler to implement and maintain than a slide-over panel

## Modal Design

- Syntax-highlighted YAML/Markdown, scrollable for long content
- Resource detection badge at top when Stigmer resource detected
- Actions: Copy, Download, Apply to [org] (primary, right-aligned)
- Keyboard: Escape to close, focus trap, Tab through actions (A11y)
- After Apply: success state replaces button with confirmation + link
