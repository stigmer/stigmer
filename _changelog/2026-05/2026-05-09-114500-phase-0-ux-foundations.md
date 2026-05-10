# Phase 0: UX Foundations for Resource Views Overhaul

**Date**: May 9, 2026

## Summary

Implemented the foundational UX primitives that unblock the resource-views-ux-overhaul project: status design tokens, a semantic EmptyState component, a toast/feedback system, and a public ActionMenu compound component. All primitives follow the SDK-first architecture (built in `@stigmer/react`, consumed by the Console) and are immediately usable by platform builders.

## Problem Statement

The Stigmer platform's resource management screens lacked foundational design system primitives needed for the upcoming Resource Workbench (Phase 1) and Detail Page Hubs (Phase 2). Specifically:

### Pain Points

- No semantic status tokens for resource lifecycle states (ready, running, failed, etc.) — forced ad-hoc color usage
- EmptyState was a private, single-variant implementation buried inside ResourceListView — no differentiation between "first use," "no results," "no permission," and "error"
- Toast/feedback lived exclusively in the Console (Sonner wrapper) — SDK components had no way to show operation feedback, and platform builders couldn't use the same system
- No public action menu primitive — resource rows had no consistent way to expose per-item actions (edit, copy ID, delete)

## Solution

Delivered four primitives in dependency order, each following the headless-first pattern (DD-003):

1. **Status Tokens** — New `--stgm-status-*` namespace in `@stigmer/theme`
2. **EmptyState** — Public component + `useEmptyState` behavior hook in `@stigmer/react`
3. **StigmerToaster + toast** — Sonner wrapper in `@stigmer/react` replacing the Console-only implementation
4. **ActionMenu** — Compound component building on internal Base UI menu primitives

## Implementation Details

### Status Tokens (`sdk/theme/src/tokens.css`)

Added 7 resource lifecycle states with the full color triple (base, foreground, subtle) in both light and dark modes:

| Token | Hue Source | Use Case |
|-------|-----------|----------|
| `--stgm-status-ready` | Success (150) | Agent ready, runner online |
| `--stgm-status-running` | Blue/Cyan (230) | Execution in progress |
| `--stgm-status-pending` | Neutral (0) | Awaiting provisioning |
| `--stgm-status-degraded` | Warning (80) | Partial failure |
| `--stgm-status-failed` | Destructive (27) | Execution failed |
| `--stgm-status-disabled` | Neutral (0) | Manually paused |
| `--stgm-status-draft` | Neutral (0) | Unpublished |

Mapped to Tailwind utilities via `@theme inline` in `sdk/react/src/styles.css`.

### EmptyState (`sdk/react/src/empty-state/`)

- **`useEmptyState(options)`** — Resolves title, description, icon, and ARIA role based on variant
- **`<EmptyState variant="..." />`** — Styled component with 4 variants (first-use, zero-results, permission, error)
- Migrated `ResourceListView` to use the new public component, removing 20 lines of private implementation

### Toast/Feedback (`sdk/react/src/feedback/`)

- **`<StigmerToaster />`** — Themed Sonner wrapper using `useColorMode()` (no `next-themes` dependency)
- **`toast`** — Re-exported Sonner `toast` function
- Added `sonner` as direct dependency (MIT, 4KB gzipped, zero transitive deps)
- Console's wrapper now re-exports from SDK

### ActionMenu (`sdk/react/src/action-menu/`)

- **`<ActionMenu>`** — Root compound component with `.Trigger`, `.Content`, `.Item`, `.Separator`, `.Group`
- Supports icon slots, keyboard shortcut hints, destructive variant
- Builds on `internal/menu.tsx` (Base UI) with portal and theme token support
- Console's Agent and Skill list pages now use ActionMenu for View/Copy ID/Delete actions

## Benefits

- **Platform builders** can now use `EmptyState`, `StigmerToaster`, `toast`, and `ActionMenu` in their embedded Stigmer experiences
- **Status tokens** enable consistent resource state visualization across all future components (StatusBadge, table rows, runner cards)
- **Phase 1 unblocked** — the Resource Workbench can build directly on these primitives
- **Reduced Console-SDK drift** — feedback system is now SDK-canonical

## Impact

- `@stigmer/theme`: 44 new lines of status token definitions
- `@stigmer/react`: 3 new modules exported, ~280 lines of new code, 1 new dependency (sonner)
- `client-apps/web`: 3 list pages enhanced with ActionMenu, improved empty states, Toaster migrated to SDK

## Related Work

- Research foundation: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/research.resource-views-ux-overhaul/04.report.gpt.md`
- Project plan: Phase 0 in the 6-phase implementation roadmap (report line 1156)
- Next: Phase 1 — Resource Workbench (table/card/list views, filters, sort, bulk actions)

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
