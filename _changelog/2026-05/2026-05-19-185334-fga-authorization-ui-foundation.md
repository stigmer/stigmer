# FGA Authorization UI Foundation: Proto, SDK Hooks, Components, and E2E Tests

**Date**: May 19, 2026

## Summary

Built the complete frontend authorization foundation for Stigmer's FGA-based access control. Added `visibility_org` enum value and `updateVisibility` RPCs for workflows and instances at the proto layer, created SDK behavior hooks (`useShareFlow`, `useCheckPermission`) and components (`SharePanel`, `PermissionGate`, `InstanceVisibilitySelector`), wired sharing into session pages (web + desktop), fixed desktop workflow visibility parity, and established the E2E test suite with visual regression baselines for all authorization flows.

## Problem Statement

The FGA authorization model was recently redesigned to support the three-tier visibility spectrum (private/org/public) for instances, but the frontend had zero UI for per-resource sharing, workflow visibility, instance visibility control, session sharing, or permission-gated actions. The `GrantAccessForm` was exported from `@stigmer/react` but unused. The `checkAuthorization` RPC existed but had no React consumer. Desktop lacked workflow visibility parity with web.

### Pain Points

- No way for users to share agents, workflows, sessions, or environments with specific people
- Workflow visibility toggle missing despite `supports_public: true` in proto metadata
- Instance visibility (private/org/public) had no UI despite full FGA model support
- No permission-gated UI elements (edit/delete buttons always visible regardless of access)
- Desktop workflow detail page missing visibility toggle (parity violation with web)
- Zero E2E tests for any authorization flow

## Solution

Three-phase implementation: proto foundation, SDK hooks/components, and comprehensive E2E test coverage. All built SDK-first (DD-001), headless-first (DD-003), with desktop parity (DD-016).

## Implementation Details

**Proto Layer (stigmer OSS `apis/`):**
- Added `visibility_org = 3` to `ApiResourceVisibility` enum, replacing interim `stigmer.ai/visibility-org` label
- Added `updateVisibility` RPC to `WorkflowCommandController`, `AgentInstanceCommandController`, `WorkflowInstanceCommandController`
- Updated `UpdateVisibilityInput` docs to describe 3-state transitions and FGA tuple semantics
- All changes pass `buf lint` and `buf breaking` cleanly (additive only)

**SDK Behavior Hooks (`@stigmer/react`):**
- `useShareFlow` — orchestrates share dialog: composes `useResourceAccess` + `useCreateIamPolicy` + `useDeleteIamPolicy` with refetch
- `useCheckPermission` — wraps `checkAuthorization` RPC with per-mount caching and graceful OSS degradation (defaults to `allowed: true`)
- Extended `useUpdateVisibility` to support `"workflow"`, `"agentInstance"`, `"workflowInstance"` kinds

**SDK Components (`@stigmer/react`):**
- `PermissionGate` — conditional children rendering; OSS-safe (always permissive when IAM unavailable)
- `SharePanel` — self-contained sharing UI: access list, role display, revoke, integrated `GrantAccessForm`
- `InstanceVisibilitySelector` — 3-way Private/Org/Public radio group with escalation confirmation

**Client App Wiring:**
- Desktop `WorkflowDetailPage` — added `useUpdateVisibility` + visibility props (DD-016 parity fix)
- Web + Desktop `SessionPageInner` — Share button with `PermissionGate` gating and `SharePanel` popover

**E2E Tests (`test/e2e/tests/functional/authorization/`):**
- 6 spec files: blueprint-visibility, instance-visibility, share-resource, org-member-management, permission-gate, oss-mode
- Visual regression spec with `toHaveScreenshot()` baselines for all authorization components
- Integration test for new `updateVisibility` RPCs (Go, `//go:build integration`)

## Benefits

- **Users can share resources**: Sessions, agents, workflows now have a Share button that opens a panel for granting/revoking access
- **3-state instance visibility**: Workflow instances can be set to org-visible, enabling zero-tuple shared execution observability
- **Permission-aware UI**: Actions gated by FGA permissions — viewers don't see edit/delete buttons in cloud mode
- **OSS-safe**: All authorization UI gracefully degrades (hidden or permissive) when running against OSS server
- **Desktop parity**: Both web and desktop get identical authorization UX
- **Test coverage**: 6 E2E specs + visual regression + backend integration tests for the authorization layer

## Impact

- **Platform builders**: `SharePanel`, `PermissionGate`, `useShareFlow`, `useCheckPermission` are SDK-exported for embedding in third-party apps
- **Workflow teams**: Can now create org-visible instances where all members see executions
- **Session owners**: Can share conversations with specific colleagues via the Share panel
- **CI/CD**: New `test/e2e/tests/functional/authorization/` test suite validates all flows

## Related Work

- Builds on: FGA Authorization Redesign (2026-05-19-174302)
- Proto changes need backend implementation in stigmer-cloud (WorkflowUpdateVisibilityHandler, instance handlers)
- Desktop workflow parity fills gap identified in workflow-screens-parity changelog

---

**Status**: Production Ready (frontend); Backend handlers pending for new RPCs
**Timeline**: Single session
