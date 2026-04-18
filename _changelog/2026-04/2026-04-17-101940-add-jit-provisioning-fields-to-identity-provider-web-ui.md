# Add JIT Provisioning Fields to Identity Provider Web UI

**Date**: April 17, 2026

## Summary

Added JIT (Just-In-Time) provisioning form controls to all Identity Provider UI components in `@stigmer/react`. The four JIT fields — `autoProvisionAccounts`, `autoGrantOnOrg`, `autoGrantRole`, and `tenantOrgClaim` — were already fully wired through the proto layer and all SDK client libraries, but the web UI had zero references to them. This closes the last gap in the JIT provisioning feature surface.

## Problem Statement

The JIT provisioning project (20260416.01) added four new fields to `IdentityProviderSpec` across proto definitions, generated stubs (TS, Go, Python, Java), and all SDK input builders. The backend validation and runtime behavior were complete. However, the `@stigmer/react` Identity Provider components — the wizard, detail panel, create form, and list panel — had no UI for these fields.

### Pain Points

- Users had no way to configure JIT provisioning from the web console without using the SDK or CLI directly
- The Identity Provider list showed only an "SSO" badge with no indication of JIT-enabled providers
- The detail panel view mode did not display JIT provisioning settings
- Cross-field validation rules (DD-001, DD-004) were enforced server-side but not reflected in the UI, leading to poor error feedback

## Solution

Added JIT provisioning form controls and display elements to all four `@stigmer/react` Identity Provider components, with full cross-field validation matching the server-side invariants from design decisions DD-001 and DD-004.

## Implementation Details

### IdentityProviderWizard.tsx (+256 lines)
- Added four JIT state variables after existing review step state
- Added cascade handlers: enabling auto-grant auto-enables auto-provision; disabling auto-provision clears all grant fields
- Added `JitProvisioningSection` to the Review step with toggle switches, role selector (excluding `owner`), and tenant org claim input
- When SSO is enabled, shows an info callout explaining JIT settings are not applicable (DD-004)
- All four fields passed through the `create()` call (only when not SSO)

### IdentityProviderDetailPanel.tsx (+294 lines)
- **View mode**: Extended with JIT field display (auto-provision status, auto-grant status, role, tenant claim) when JIT is active
- **Edit mode**: Added `JitEditSection` with the same form controls as the wizard
- Replaced SSO-only badge with `ProvisioningModeBadge` showing "SSO" or "JIT"
- Added `formatIamRole` helper for human-readable role display in view mode
- JIT fields passed through the `update()` call

### CreateIdentityProviderForm.tsx (+220 lines)
- Mirrors the wizard's JIT controls in the simpler single-step form
- Same cascade handlers and SSO conditional visibility

### IdentityProviderListPanel.tsx (+11 lines)
- Added `isJit` flag derived from `spec.autoProvisionAccounts && !isSso`
- JIT badge rendered alongside the existing SSO badge in list rows

### Cross-Field Validation Rules (client-side)
1. `autoGrantOnOrg = true` auto-enables `autoProvisionAccounts = true`
2. `autoGrantRole` and `tenantOrgClaim` only shown when `autoGrantOnOrg = true`
3. Disabling `autoProvisionAccounts` cascades to clear all grant fields
4. `owner` role excluded from the auto-grant role selector
5. When `isSsoProvider = true`, JIT grant fields hidden with explanatory callout

## Benefits

- Users can now configure JIT provisioning entirely from the web console
- Provisioning mode (SSO/JIT/Manual) is visible at a glance in the list view
- Cross-field validation prevents invalid configurations before they hit the server
- SSO providers clearly communicate that JIT settings are managed automatically

## Impact

- **@stigmer/react SDK**: Four components updated — this is the public integration surface used by both the Stigmer Console and platform builders embedding Identity Provider management
- **Platform builders**: Anyone embedding `IdentityProviderWizard`, `IdentityProviderDetailPanel`, `CreateIdentityProviderForm`, or `IdentityProviderListPanel` automatically gets JIT provisioning support
- **End users**: Web console users can now configure the full JIT provisioning flow without CLI or SDK

## Related Work

- Part of project `20260416.01.jit-provisioning` (sessions 1-8 covered proto, backend, validation, docs, demos)
- Design decisions DD-001 (separate identity and authorization controls), DD-004 (reject JIT fields on SSO providers)
- Proto fields defined in `apis/ai/stigmer/iam/identityprovider/v1/spec.proto` (fields 9-12)

---

**Status**: ✅ Production Ready
**Timeline**: Session 9 of the JIT provisioning project
