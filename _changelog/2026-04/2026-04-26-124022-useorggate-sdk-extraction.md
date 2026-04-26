# Extract `useOrgGate()` Behavior Hook to @stigmer/react SDK

**Date**: April 26, 2026

## Summary

Extracted the org-gate provisioning state machine from both the desktop and web client apps into a headless `useOrgGate()` behavior hook in `@stigmer/react`. Both client-app `OrgGate` components are now thin renderers that delegate state resolution to the SDK hook, eliminating ~40 lines of duplicated state machine logic per app.

## Problem Statement

Both `client-apps/desktop/src/org/OrgGate.tsx` and `client-apps/web/src/domain/_shared/org/OrgGate.tsx` implemented an identical provisioning state machine — same polling constants, same timeout logic, same state transitions, same "set state during render" pattern. This violated DD-001 (SDK-first development) and created a maintenance burden where any bug fix or behavior change would need to be applied in two places.

### Pain Points

- Duplicated provisioning state machine across desktop and web (identical logic, different rendering)
- Risk of behavioral drift between the two apps if one is updated without the other
- No reusable hook for platform builders who might need similar org-gating behavior

## Solution

Created a headless behavior hook (`useOrgGate`) that encapsulates the provisioning state machine and returns a discriminated union (`OrgGateState`) that consumers switch on for rendering. The hook takes framework-specific inputs (`isBypassed`, `isOidcMode`) as options, keeping it free of routing and auth framework dependencies (DD-004).

## Implementation Details

**New file**: `sdk/react/src/organization/useOrgGate.ts`

The hook manages:
- `provisioningStarted` / `provisioningTimedOut` local state
- Polling effect with `setInterval(refresh, 2s)` + `setTimeout(timedOut, 10s)`
- State resolution into `OrgGateState`: `bypassed` | `loading` | `provisioning` | `error` | `no-orgs` | `ready`

**Type design**: `OrgGateState` is a discriminated union on `status` with variant-specific payloads (e.g. `message` on the `error` variant). This deviates from `AgentSetupState`'s orthogonal error pattern because for the org gate, error is a terminal status, not an overlay.

**Consumer pattern**: Both `OrgGate.tsx` files now compute `isBypassed` + `isOidcMode` locally (using framework-specific APIs), call `useOrgGate()`, and render via `switch (state.status)`. All rendering sub-components (`GateHeader`, `ProvisioningState`, `LoadingState`, `ErrorState`, `OnboardingState`) remain local and unchanged.

## Benefits

- Single source of truth for org-gate provisioning behavior
- ~40 lines of duplicated state machine logic removed from each consumer
- Clean separation: SDK owns behavior, client apps own rendering
- Type-safe consumer code via discriminated union narrowing
- Follows established SDK patterns (`status` discriminant, actions on hook return)

## Impact

- **SDK (`@stigmer/react`)**: New public exports — `useOrgGate`, `UseOrgGateOptions`, `OrgGateState`, `UseOrgGateReturn`
- **Desktop app**: `OrgGate.tsx` simplified to thin renderer
- **Web app**: `OrgGate.tsx` simplified to thin renderer
- **Platform builders**: Can use `useOrgGate()` for org provisioning flows if needed

## Related Work

- T01-A: OrgProvider SDK extraction (prior session, committed as `1b26308c2`)
- T01-C (next): OrgSwitcher component extraction
- Project: `20260426.01.desktop-web-ux-parity`

---

**Status**: Production Ready
**Timeline**: T01-B subtask of the Desktop/Web UX Parity project
