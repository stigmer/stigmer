# Fleet View Polish — Sorting, Filtering, and Empty States for Runner Management

**Date**: May 9, 2026

## Summary

Added sorting, filtering, empty states, and a fleet health summary to the runner fleet views across both the SDK (`RunnerListPanel`) and Desktop (`OrgFleetSection`). Extracted shared runner UI utilities (`PhaseBadge`, `RunnerIcon`, `formatRelativeTime`) into a dedicated SDK module to eliminate triple duplication. Both type-check passes compile clean with zero errors.

## Problem Statement

The runner fleet UI shipped in T05 as a functional but bare-bones list. Several usability gaps remained:

### Pain Points

- `OrgFleetSection` returned `null` when empty — the section simply vanished with no user feedback
- `RunnerListPanel` used custom inline empty/error JSX instead of the shared `EmptyState` component, inconsistent with the rest of the platform
- No way to filter runners by phase — users managing fleets with mixed states had to scan the full list
- No name/hostname search for larger fleets
- Sorting was hardcoded to phase-then-name with no user control
- `formatRelativeTime`, `PhaseBadge`, and `RunnerIcon` were duplicated across three files: SDK `RunnerListPanel`, Desktop `OrgFleetSection`, and Desktop `ThisMachineCard`

## Solution

Proportional enhancement of both SDK and Desktop layers. A lightweight filter/sort approach was chosen over the heavyweight `ResourceWorkbench` pattern because runners are a monitoring view for ~5-20 items, not a searchable catalog of hundreds.

## Implementation Details

### SDK Layer (`@stigmer/react`)

- **`sdk/react/src/runner/shared.tsx`** (new): Extracted `RunnerIcon`, `PhaseBadge`, `formatRelativeTime` with proper JSDoc, typed props interfaces (`RunnerIconProps`, `PhaseBadgeProps`), and SDK-level exports.
- **`RunnerListPanel`**: Replaced inline empty state with `EmptyState` component (`first-use` when org has no runners, `zero-results` when filters hide all, `error` with retry action). Added optional props: `filterPhases` (phase whitelist), `searchQuery` (name/hostname substring), `sortBy` (`"phase"` | `"name"` | `"heartbeat"` | `"executions"`), `sortDirection` (`"asc"` | `"desc"`). All backward-compatible — existing consumers are unaffected.
- **New exports**: `RunnerSortKey`, `RunnerIcon`, `RunnerIconProps`, `PhaseBadge`, `PhaseBadgeProps`, `formatRelativeTime` added to both module and package-level barrels.

### Desktop Layer (`client-apps/desktop`)

- **`OrgFleetSection`**: Fleet summary line ("X of Y active"), toggleable phase filter chips with per-phase counts (only chips with runners are shown), debounced name/hostname search (shown for fleets > 5 runners), compact sort dropdown (phase/name/heartbeat/executions with direction toggle), proper `EmptyState` variants (first-use: "No other runners in your organization", zero-results: "No runners match your filters" with clear action).
- **`ThisMachineCard`**: Removed local `formatRelativeTime` copy, imports from `@stigmer/react`. Cleaned up unused `useCallback` import.

## Benefits

- **Consistent empty states**: Both SDK and Desktop use the shared `EmptyState` component with appropriate semantic variants
- **Reduced duplication**: Three copies of `formatRelativeTime`, `PhaseBadge`, `RunnerIcon` consolidated to one source in the SDK
- **Fleet monitoring at a glance**: Summary line and phase chips give instant fleet health visibility without scanning individual rows
- **Discoverable filtering**: Phase chips with counts surface the fleet composition; search and sort let power users navigate larger fleets
- **SDK extensibility**: Platform builders can now control `RunnerListPanel` filtering and sorting via props without building their own list

## Impact

- **SDK consumers**: New optional props on `RunnerListPanel`; no breaking changes
- **Desktop users**: Richer fleet management with filter/sort/search affordances
- **Maintainers**: Single source of truth for shared runner UI utilities

## Related Work

- T05 (session 5): Desktop UI redesign — created `OrgFleetSection`, `ThisMachineCard`, `FirstRunPrompt`
- T01-T04 (sessions 1-4): CLI adoption, idempotent ensure, machine identity, control socket

---

**Status**: Production Ready
**Timeline**: Single session (~45 minutes)
