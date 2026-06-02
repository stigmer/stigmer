# Workflow Instance Management UX

**Date**: May 24, 2026

## Summary

Implemented the complete Workflow Instance management UX — from backend visibility handler through SDK mutation hooks, EnvironmentPicker component, enhanced instance list with empty state, create dialog, detail panel with sharing/delete, and refined run dialog with instance-aware picker. This enables users to create configured deployments of workflows with environment bindings, manage their lifecycle, and control access.

## Problem Statement

The WorkflowInstance resource was fully defined at the proto and backend level (both Go OSS and Java Cloud) but the frontend only had a bare read-only table showing Name, Visibility, and ID. Users could not:
- Create new instances with different environment configurations
- Edit instance environment bindings after creation
- Delete instances
- Share/grant access to instances per-team
- See which environments an instance binds
- Choose between instances when running a workflow (unless >1 existed including the hidden default)

### Pain Points

- "No instances found" message was confusing (default exists but is hidden)
- No way to create configured deployments without CLI/API
- No environment visibility in the instance list
- Run dialog instance picker threshold was accidentally correct but fragile
- OSS Go server was missing `updateVisibility` handler (visibility toggle would fail)

## Solution

Full-stack implementation spanning backend (Go), SDK hooks (TypeScript), UI components (React), and E2E tests (Playwright). Progressive disclosure design: zero-instance path remains effortless; multi-instance management is discoverable and efficient.

## Implementation Details

### Phase 0: Backend (OSS Go)
- `update_visibility.go` — Pipeline-based handler (validate → load → set → persist → index) matching Agent/Skill/McpServer pattern

### Phase 1: SDK Mutation Hooks (`sdk/react/src/workflow/instance/`)
- `useWorkflowInstance` — single-resource data hook via `useFetch`
- `useCreateWorkflowInstance` — create mutation following `useCreateAgentInstance` pattern
- `useUpdateWorkflowInstance` — update mutation following `useUpdateWorkflow` pattern
- `useDeleteWorkflowInstance` — delete mutation following `useDeleteApiKey` pattern (standalone, cascade-aware)

### Phase 2: EnvironmentPicker (`sdk/react/src/environment/`)
- Multi-select component with ordered list from `useEnvironmentList`
- Arrow up/down buttons for accessible reordering (no drag dep needed)
- Merge-priority messaging ("later entries override earlier ones")

### Phase 3: Instance List Enhancement
- `WorkflowInstanceList` — enhanced table with environment chips, visibility (FGA-gated), actions
- `WorkflowInstanceEmptyState` — value proposition + Create CTA
- Default instance filtered client-side via `workflow.status.defaultInstanceId`
- Replaced inline `InstancesTab` in `WorkflowDetailView` with new standalone component

### Phase 4: Create Instance Dialog
- Native `<dialog>` with name, description, EnvironmentPicker, InstanceVisibilitySelector
- Auto-fills `workflowId` from context; visibility defaults to Private

### Phase 5: Instance Detail Panel
- Inline-editable description and environment bindings
- SharePanel integration (FGA-gated `can_grant_access`)
- Delete with explicit cascade warning ("permanently delete this instance and all its execution history")
- Visibility control with PermissionGate

### Phase 6: Run Dialog Refinement
- Added `defaultInstanceId` prop to `WorkflowRunForm` and `WorkflowRunDialog`
- Changed picker threshold: shows when `userInstances.length >= 1` (not total `> 1`)
- Environment count labels per instance option
- Both client apps (web + desktop) pass `workflow.status?.defaultInstanceId`

### Phase 7: Tests
- Unit tests for create/update/delete hooks (renderHook + mock client)
- E2E test spec for instance lifecycle (create, visibility, run against, delete cascade)

## Benefits

- Users can now create and manage workflow instances entirely from the UI
- Environment binding is visual and ordered (merge semantics communicated)
- Access control per-instance via existing FGA infrastructure
- Run dialog intelligently shows picker only when relevant
- OSS parity: visibility toggle now works on both editions

## Impact

- **SDK surface**: 4 new hooks + 5 new components exported from `@stigmer/react`
- **Client apps**: Both web and desktop updated (DD-016 parity)
- **Backend**: 1 new Go file (OSS visibility handler)
- **Tests**: 1 unit test file + 1 E2E spec
- **Zero breaking changes**: All new props are optional with backward-compatible defaults

## Related Work

- Builds on T01-T12 workflow UX overhaul (graph visualization, execution viewer, inspector)
- Uses existing IAM infrastructure (SharePanel, PermissionGate, InstanceVisibilitySelector)
- Uses existing Environment hooks (`useEnvironmentList`)
- Precursor to Agent Instance management (same pattern, different lifecycle)

---

**Status**: Production Ready
**Timeline**: Single session implementation
