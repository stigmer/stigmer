# FGA Permission Gating, Workflow Sharing, Instance Visibility Wiring, and Codegen Fix

**Date**: May 19, 2026

## Summary

Applied the redesigned FGA authorization model to the OpenFGA server, permission-gated the VisibilityToggle across all resource detail views, added Share button to workflow detail pages, wired InstanceVisibilitySelector into workflow instance tables, regenerated TypeScript stubs and SDK client code for the new `updateVisibility` RPCs, and implemented the Java backend handlers for Workflow, AgentInstance, and WorkflowInstance visibility updates.

## Problem Statement

The FGA Authorization UI Foundation (159488218) shipped with several gaps: the VisibilityToggle rendered for all users including non-owners, the workflow detail page lacked a Share button (session pages had one), the InstanceVisibilitySelector was built but unwired, the TypeScript proto stubs and SDK client code were never regenerated after proto changes (causing typecheck failures), and the redesigned FGA model was never applied to the OpenFGA server. Backend handlers for the new `updateVisibility` RPCs were also missing.

### Pain Points

- Non-owners saw an interactive visibility toggle they couldn't use (server would reject on click)
- Workflow pages had no way to share resources, breaking parity with session pages (DD-016)
- InstanceVisibilitySelector component was built but never wired into any UI
- `npm run typecheck` failed across SDK and desktop due to missing `visibility_org` enum and `updateVisibility` methods in generated stubs
- The FGA model on the server was stale (pre-redesign), blocking instance visibility features
- No backend handlers existed for Workflow/AgentInstance/WorkflowInstance updateVisibility RPCs

## Solution

Multi-layer fix: FGA model deployment, SDK permission gating, client app wiring, codegen pipeline, and Java backend handlers.

## Implementation Details

**FGA Model Applied (stigmer-cloud):**
- Applied redesigned model to OpenFGA server (new ID: `01KS07SS5N0AGT35J9T57NXPFZ`)
- Updated `openfga-config.yaml` and applied to Planton

**SDK PermissionGate Wrapping (`@stigmer/react`):**
- `WorkflowDetailView`, `AgentDetailView`, `SkillDetailView`, `McpServerDetailView`: VisibilityToggle now wrapped in `PermissionGate` with `can_edit` relation
- Non-owners see a static "Public" badge (fallback); owners see the interactive toggle
- Zero framework dependencies — works in any React environment

**Workflow Sharing (desktop + web):**
- Both `WorkflowDetailPage` variants: added "Share" action in kebab menu
- `SharePanel` popover with `PermissionGate` (`can_grant_access`) gating
- Follows identical pattern to session page sharing

**InstanceVisibilitySelector Wiring:**
- `WorkflowDetailView` Instances tab: added Visibility column with inline 3-way selector
- Each instance row uses `PermissionGate` for owner/viewer distinction
- `useUpdateVisibility("workflowInstance", ...)` for per-row visibility updates

**TypeScript Codegen Fix:**
- Regenerated TS proto stubs via `make ts-stubs` (adds `visibility_org` enum value)
- Added `UpdateVisibility` method to service schemas for workflow, agentinstance, workflowinstance
- Regenerated SDK client code via `make codegen` (adds `updateVisibility()` methods)
- All typecheck and lint pass cleanly (0 errors)

**Java Backend Handlers (stigmer-cloud):**
- `WorkflowUpdateVisibilityHandler`: blueprint pattern (private/public), public viewer FGA tuples
- `AgentInstanceUpdateVisibilityHandler`: instance pattern (private/org/public), org + public FGA tuples
- `WorkflowInstanceUpdateVisibilityHandler`: same instance pattern
- All follow the 8-step pipeline: validate → load → authorize → set → persist → tuples → transform → respond
- Regenerated all proto stubs (Java, Go, Python, TS, Dart) in stigmer-cloud

## Benefits

- **Correct permission behavior**: Non-owners no longer see controls they can't use
- **Workflow sharing**: Owners can share workflows with specific people via the kebab menu
- **Instance visibility**: Org-wide execution observability is now configurable per-instance
- **Clean typecheck**: SDK and desktop compile without errors
- **Backend ready**: All three `updateVisibility` RPCs have Cloud handlers

## Impact

- **All resource detail views**: Permission-gated visibility toggle (Agent, Workflow, Skill, MCP Server)
- **Workflow pages**: Share button parity with session pages
- **Workflow instances**: Inline visibility control in the Instances tab
- **CI/CD**: Typecheck pipeline unblocked
- **Backend**: Three new Java handlers ready for deployment

## Related Work

- Builds on: FGA Authorization UI Foundation (2026-05-19-185334)
- Builds on: FGA Authorization Redesign (2026-05-19-174302)
- Backend handlers need Java service restart with new FGA model ID

---

**Status**: Production Ready
**Timeline**: Single session
