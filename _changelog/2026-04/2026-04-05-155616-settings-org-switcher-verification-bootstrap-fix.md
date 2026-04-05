# OrgSwitcher Management Zone Verification & PersonalEnvironmentCard Bootstrap Fix

**Date**: April 5, 2026

## Summary

Verified that the OrgSwitcher component works correctly in the new management zone sidebar and discovered a subtle bug in `PersonalEnvironmentCard` where the `bootstrapAttempted` ref was not reset on org switch, silently preventing personal environment auto-creation for subsequent organizations. The fix is a 5-line `useEffect` that respects React's lint rules and effect execution order.

## Problem Statement

As part of the settings layout refactor (zone separation), the `OrgSwitcher` was moved into the `ManagementSidebar` for the management zone. While it reuses the same component from the session zone, its behavior in the new context — and its downstream effects on settings section data fetching — had not been verified.

### Pain Points

- No verification that OrgSwitcher worked identically in the management zone
- No confirmation that switching orgs in the management zone correctly triggered data refetch in settings sections (Members, API Keys, Environments)
- `PersonalEnvironmentCard` used a `useRef` guard (`bootstrapAttempted`) that was initialized once and never reset, meaning the auto-create logic would silently skip for every org after the first

## Solution

Performed a comprehensive code-level and browser-level verification of the OrgSwitcher in the management zone. During the code audit, identified the bootstrap ref bug in `PersonalEnvironmentCard` and fixed it with a `useEffect` keyed on the `org` prop that resets the guard, declared before the bootstrap effect to leverage React's guarantee that effects run in declaration order.

## Implementation Details

### Bug Fix: `EnvironmentsSection.tsx`

The `PersonalEnvironmentCard` component uses a `bootstrapAttempted` ref to guard against duplicate `getOrCreate` calls. When `org` changes (via OrgSwitcher), the component re-renders but does not unmount — so the ref retains its `true` value, short-circuiting the bootstrap for the new org.

**Fix** — a `useEffect` before the bootstrap effect:

```tsx
useEffect(() => {
  bootstrapAttempted.current = false;
}, [org]);
```

This resets the guard in an effect (avoiding the `react-hooks/refs` lint rule that prohibits ref mutations during render). React guarantees effects execute in declaration order, so the reset fires before the bootstrap check.

### Verification Matrix

| Component / Hook | Org-Change Reactive? | Mechanism |
|---|---|---|
| `OrgSwitcher` | N/A — it drives the change | `useOrg()` context |
| `OrgMembersPanel` → `usePrincipalsCount` | Yes | Effect dependency on `orgId` |
| `EnvironmentListPanel` → `useEnvironmentList` | Yes | Effect dependency on `orgSlug` |
| `PersonalEnvironmentCard` → `usePersonalEnvironment` | Yes (after fix) | Effect + ref reset on `org` |
| `ApiKeyListPanel` | Identity-scoped | Intentionally no org dependency |

## Benefits

- **Correctness**: Personal environment auto-creation now works reliably across org switches
- **Confidence**: Verified that all settings sections respond correctly to org changes
- **Architecture validation**: Confirmed zone separation does not introduce regressions in shared components

## Impact

- **Users**: Switching orgs in the management zone now correctly bootstraps the personal environment for the new org
- **Codebase**: Single 5-line change; no structural impact; `make lint` clean
- **Platform**: Validates the headless-first SDK hook pattern — hooks with prop-based reactivity work correctly in both zones

## Related Work

- Settings layout refactor: `_projects/2026-04/20260405.03.settings-layout-refactor/`
- Session 4 changelog: mobile sidebar auto-close and responsive padding
- SDK hook pattern: render-time state sync with effect-based refetch (established in `@stigmer/react`)

---

**Status**: Production Ready
**Timeline**: ~2 hours (code audit, fix, lint, browser verification)
