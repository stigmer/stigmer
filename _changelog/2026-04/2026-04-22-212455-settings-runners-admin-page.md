# Settings > Runners Admin Page (T09)

**Date**: April 22, 2026

## Summary

Added a Settings > Runners admin page that gives organization administrators full visibility into their runner fleet. The `RunnerListPanel` was built SDK-first in `@stigmer/react` and consumed by the Console. Phase display utilities were extracted into a shared module, eliminating duplication between the session composer's runner picker and the new admin panel.

## Problem Statement

After T08 added the runner picker to the session composer, there was no admin view for the full runner fleet. Operators had no web UI to see all runners in their organization — including system-managed ephemeral runners that the composer intentionally hides.

### Pain Points

- No web UI for runner fleet visibility — admins had to use CLI (`stigmer list runners`) or API calls
- System-managed (cloud-provisioned) runners were invisible in the web experience
- Phase display logic (labels, colors, sort order) was duplicated inline in `RunnerPicker` and would need re-implementation in any new runner view
- Settings navigation had no "Infrastructure" category for compute resources

## Solution

Built a three-layer implementation following the established SDK-first architecture: shared phase utilities, an SDK `RunnerListPanel` component, and thin Console wrappers.

## Implementation Details

### Shared Phase Utilities (`sdk/react/src/runner/phase.ts`)

Extracted from `RunnerPicker` inline logic into pure, non-React functions:
- `phaseLabel(phase)` — human-readable labels ("Ready", "Busy", "Stopped", etc.)
- `phaseDotColor(phase)` — Tailwind `bg-*` classes for colored dot indicators
- `isActivePhase(phase)` — boolean for READY/BUSY
- `PHASE_SORT_ORDER` — numeric sort map (active phases first)

`RunnerPicker` was refactored to import these utilities — pure refactor, zero behavior change.

### RunnerListPanel (`sdk/react/src/runner/RunnerListPanel.tsx`)

SDK component following the `ApiKeyListPanel` pattern:
- Card-row list with `role="list"` / `role="listitem"` semantic markup
- Phase badge (colored dot + label) per runner
- "System" badge for `stigmer.ai/system-managed: "true"` runners
- Responsive metadata columns: hostname, OS/arch, version, execution count, last heartbeat
- Inactive runners (STOPPED/FAILED/PENDING) rendered with `opacity-60`
- Loading skeletons, error state with `getUserMessage()`, empty state with CLI guidance
- `includeSystemManaged` defaults to `true` for admin visibility
- `onRefetchRef` callback for parent-triggered refresh (standard settings panel pattern)

### Console Integration

- `RunnersSection.tsx` — thin section wrapper with heading and description
- `settings/runners/page.tsx` — thin Next.js route
- `settings-nav.ts` — new "Infrastructure" group between Configuration and Billing & Usage

### Barrel Exports

`RunnerListPanel`, `RunnerListPanelProps`, and all phase utilities added to both `runner/index.ts` and `sdk/react/src/index.ts`.

## Benefits

- **Admin visibility**: operators can see all runners (user-created + system-managed) in one place
- **SDK-first**: `RunnerListPanel` is embeddable by platform builders — zero Console dependencies
- **DRY phase logic**: phase display semantics live in one place, shared across picker and admin panel
- **Public phase API**: platform builders who build custom runner UIs can import `phaseLabel`, `phaseDotColor`, etc.
- **Clean taxonomy**: "Infrastructure" nav group is forward-looking for future items (storage, proxies)

## Impact

- **Platform builders**: can embed `<RunnerListPanel org="..." />` in their own admin dashboards
- **Console users**: Settings > Infrastructure > Runners page for fleet monitoring
- **SDK consumers**: phase utilities available as public API for custom rendering
- **Codebase**: eliminated phase display duplication, established shared runner utility pattern

## Related Work

- T08 (Runner Picker in Session Composer) — the picker that `RunnerListPanel` now shares phase logic with
- T07 (Dispatch Enhancement) — the backend dispatch that runners route through
- 20260422.02 (Runner Command Stream) — bidi stream infrastructure that future runner actions will use
- Runner as a Resource project (20260420.01) — the proto/backend foundation this UI builds on

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
