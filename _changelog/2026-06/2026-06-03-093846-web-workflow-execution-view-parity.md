# Web Workflow Execution View: Layout + Navigation Parity

**Date**: June 3, 2026

## Summary

The web console's workflow execution view had drifted out of parity with the
desktop app: clicking an execution reloaded the whole page, the execution
header was missing, and the right-side agent-call inspector was hidden. Both
apps render the *same* `WorkflowExecutionViewer` from `@stigmer/react`, so the
SDK was never at fault — the divergence lived entirely in the web app's page
shell and navigation. This change restores parity by fixing the broken page
shell and introducing static-export-safe soft navigation for executions, built
on a single shared client-path source of truth.

## Problem Statement

The desktop app showed the workflow execution detail view correctly — a header
with the execution name, the DAG graph, a resizable right inspector (agent
call / task details), and the bottom waterfall. The web app, rendering the
identical SDK component, looked broken: the header was clipped off the top, the
inspector was pushed off the right edge, and every click on an execution
triggered a full document reload.

This is a [DD-016](/.cursor/rules/client-apps/sdk-console-architecture.mdc)
client-app parity violation — the shared SDK component was wired into a broken
host shell on web while desktop wired it correctly.

### Pain Points

- **Full page reload on every execution click.** Navigating to an execution
  (from the sidebar, dashboard, workflow detail, or execution list) reloaded
  the entire app, discarding in-memory state and flashing a blank screen.
- **No execution header.** The execution name, phase badge, duration, cost, and
  lifecycle actions were rendered by the SDK but clipped above the scrollport.
- **Hidden right inspector.** The agent-call / task-details panel was pushed
  past the right edge of the viewport and effectively invisible.
- **Misplaced layout.** The viewer scrolled as one block inside an outer
  scroll container instead of filling the pane like the session view.

## Solution

Two independent root causes, fixed independently:

1. **Layout** — Replace the broken page-shell wrapper with the same
   container pattern the working session page uses (`flex h-full w-full`),
   removing negative margins and viewport-height math that assumed padding and
   an app header that the web shell does not have.

2. **Navigation** — Introduce a single client-side path source of truth so
   executions can soft-navigate under static export, exactly as sessions
   already do. Crucially, this is *one* source of truth rather than a second
   independent navigation provider: `usePathname()` does not fire on manual
   `history.pushState`, so two independent `pushState` providers cannot observe
   each other's transitions and their derived zone state would drift out of
   sync with the URL. One shared `currentPath` makes the zones mutually
   consistent by construction.

## Implementation Details

### Root cause 1 — broken page shell (layout)

`client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx` wrapped
the viewer in `-mx-6 -my-8 flex h-[calc(100vh-var(--header-height,64px))]`. The
negative margins negated padding that does not exist in this route's parent
(the `AppShell` scroll container has no padding — padding lives in per-page
layouts like `DashboardPage`/`LibraryLayout`, which this route never uses), and
the height calc subtracted a phantom 64px header the web shell lacks.

Replaced with `relative flex h-full w-full flex-col`, matching `SessionPage`.
The `relative` scopes the "Navigating to session…" overlay.

### Root cause 2 — static-export soft navigation

The web app uses static export (`output: "export"`) in production, where
Next.js cannot soft-navigate to dynamic routes that were not pre-rendered.
Sessions already solved this with a dedicated provider; executions had no
equivalent and fell back to full reloads.

A naive "mirror" (a second independent provider) is incorrect because the two
providers cannot coordinate across `pushState` transitions. Instead the
navigation *mechanism* was generalized into one source of truth, with the
domain-specific behavior layered on top as thin consumers:

- **`domain/_shared/navigation/app-navigation.tsx`** (new) —
  `AppNavigationProvider` owns `currentPath` and `navigate(path)` (pushState),
  syncs on `popstate`, and adopts genuine Next.js navigations. This is the
  single source of truth for the current in-app path.
- **`domain/session/session-navigation.tsx`** (refactored) — now a thin
  consumer of `useAppNavigation`. Its public API (`useSessionNavigation`,
  including `activeSessionId`, `isSessionZone`, `lastSessionZonePath`,
  `navigateToSession`, `navigateToHome`) is unchanged, so no session call sites
  moved.
- **`domain/workflow/execution-navigation.ts`** (new) —
  `useExecutionNavigation()` exposing `activeExecutionId`, `isExecutionZone`,
  and `navigateToExecution(id)`. Zone-derived with no extra state, so it is a
  plain hook (no dedicated provider).
- **`AppShell.tsx`** — gained an execution-zone branch that renders the
  execution view from `currentPath` state (keyed by `activeExecutionId`),
  preserving the `wex_*` (workflow execution) vs. `aex_*` (agent execution)
  split — `aex_*` ids resolve to their parent session and hand off via
  `navigateToSession`.
- **`app/layout.tsx`** — wraps the tree in `AppNavigationProvider` above
  `SessionNavigationProvider`.
- **`app/executions/[id]/page.tsx`** — reduced to a no-op placeholder mirroring
  `/sessions/[id]`; the redundant `ExecutionRoute.tsx` was deleted since the
  zone now owns all execution rendering (no duplicated `aex_/wex_` logic).

### DD-016 entry-point sweep

Every execution navigation entry point was converted from hard/Next navigation
to `navigateToExecution`:

- `Sidebar.tsx` — recents (was `window.location.href`); active-state detection
  now uses `activeExecutionId` from the hook and guards dashboard/library
  highlighting with `!isExecutionZone`.
- `DashboardPage.tsx` — approval-click and failed-run-click handlers.
- `WorkflowDetailPage.tsx` — run success, view-latest-run, and
  `onExecutionClick` (the unrelated `/library/workflows` redirect still uses
  the Next router).
- `WorkflowExecutionListPage.tsx` — row click and keyboard activation.

### Tests

- **Unit** (`domain/_shared/navigation/__tests__/navigation.test.tsx`, 10
  tests) — `navigate` updates `currentPath` and calls `pushState`; same-path
  navigation is a no-op; `popstate` sync; Next.js navigation adoption; zone
  derivation for session/execution/neither; and the cross-zone no-desync
  invariant (both zones can never be active at once).
- **E2E** (`test/e2e/tests/interactive/workflow-execution-flow.spec.ts`) — a
  viewport-bounds guard for the clipping regression (header and inspector must
  sit inside the viewport, since `toBeVisible()` alone does not catch
  off-screen clipping), and a sidebar "no reload" test using a window-scoped
  sentinel that survives only under soft navigation.

## Benefits

- **No more full reloads.** Switching executions keeps the entire React tree
  (providers, sidebar, SDK client) mounted — instant, flash-free transitions
  matching the session experience.
- **Header and inspector visible.** The execution name, phase, cost, lifecycle
  actions, and the agent-call inspector render correctly within the pane.
- **One coherent navigation model.** Sessions and executions now share a single
  client-path source of truth, eliminating an entire class of zone-desync bugs
  and giving any future dynamic detail route a ready-made soft-nav primitive.
- **Less code, no duplication.** The redundant `ExecutionRoute` was removed; the
  execution placeholder route now mirrors the session pattern exactly.

## Impact

- **Web console users** get a working, parity-matched workflow execution view.
- **Platform builders** are unaffected — the change is confined to the web
  client app; the `@stigmer/react` SDK and the desktop app are untouched, so
  no embeddable component contracts changed.
- **Future maintainers** inherit a single, documented navigation primitive
  (`useAppNavigation`) instead of per-zone providers that must be kept in sync.

## Related Work

- [DD-016 client-app parity](/.cursor/rules/client-apps/sdk-console-architecture.mdc)
  — the principle this change restores.
- `2026-06-02-140642-fix-workflow-execution-switch-stale-progress.md` — prior
  work on execution-switch behavior in the shared viewer.
- `2026-06-01-132529-fix-recents-sidebar-flicker-on-refetch.md` — related
  sidebar/recents navigation work.

---

**Status**: ✅ Production Ready
**Timeline**: Single session (web client app only)
