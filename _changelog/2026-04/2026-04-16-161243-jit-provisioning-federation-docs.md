# Document JIT Provisioning Across the Federation Guide

**Date**: April 16, 2026

## Summary

Updated all six federation guide pages and two demo scenarios to document JIT (Just-In-Time) provisioning as a first-class provisioning mode alongside manual provisioning and SSO. The federation guide now presents three clear paths — JIT, manual, and SSO — with consistent routing, comparison tables, and SDK examples in all four languages.

## Problem Statement

The federation guide documented only two provisioning paths: manual (platform backend provisions accounts via API) and SSO (web console auto-login). With JIT provisioning added in the backend (T01-T07), the documentation was factually incomplete — the authentication-flow page incorrectly stated that platform-managed IdPs always return 401 for unknown subjects, which is no longer true when JIT is enabled.

### Pain Points

- Readers could not discover JIT provisioning from the existing docs
- The authentication-flow page contained a factually incorrect statement about identity resolution
- No guidance existed for choosing between provisioning modes
- The multi-tenant guide had no documentation for `tenantOrgClaim` automatic tenant routing
- Demo scenarios did not illustrate JIT configuration or auto-provisioning

## Solution

Wove JIT documentation into existing pages rather than creating a new page, preserving the guide's sequential structure while adding clear path routing for JIT users. Updated two demo scenarios to illustrate JIT visually.

## Implementation Details

### Pages updated (6 of 7 federation guide pages)

**overview.mdx**: Rewrote opening to present three provisioning modes. Added "Choose your provisioning mode" comparison table (JIT vs manual vs SSO). Updated architecture explanation and guide structure cards with JIT routing callout.

**register-identity-provider.mdx** (most significant): Added 4 JIT fields to field table. Added full "Enable JIT provisioning" section with SDK examples in TypeScript, Go, Python, Java. Added role selection table, JIT-without-grants explanation, DD-004 callout (SSO mutual exclusion), and bridge callout directing JIT users to skip ahead. Updated "What's next" to route both paths.

**authentication-flow.mdx**: Updated opening, sequence diagram (JIT auto-provision note), rewrote Step 7 for three outcomes (JIT/SSO/manual), updated Step 8-9 for auto-grant, updated 401 troubleshooting table, added JIT-specific 403 diagnostics, split summary into JIT and manual variants.

**provision-federated-accounts.mdx**: Added JIT callout at top redirecting readers with JIT enabled.

**grant-access.mdx**: Added `autoGrantOnOrg` callout at top redirecting JIT users.

**multi-tenant-setup.mdx**: Added comprehensive "JIT provisioning for multi-tenant platforms" section — `tenantOrgClaim` resolution algorithm, SDK examples in 4 languages, DD-003 error handling (fail-closed with descriptive error), missing claim rejection, JIT vs manual comparison table.

### Demo scenarios updated (2)

**DemoRegisterIdpPlayback**: Added "Enable JIT provisioning" step with toggle UI for auto-provision and auto-grant fields. Updated success step to show JIT badge and configuration. Now a 6-step flow.

**DemoAuthenticationFlowPlayback**: Updated resolve-authorize step to show JIT auto-provisioning with 3 checks (resolve identity, auto-grant role, check IAM Policy). Updated narration and cursor interactions.

### Page not changed

**sso-login.mdx**: SSO and JIT authorization fields are mutually exclusive per DD-004. No JIT content belongs here.

## Benefits

- Federation docs are now factually complete with JIT provisioning
- Readers can discover the JIT path from the overview page and make an informed choice
- The register-identity-provider page serves as a complete quick-start for JIT users
- Multi-tenant platforms have clear documentation for zero-code tenant routing via `tenantOrgClaim`
- Demo scenarios visually illustrate JIT configuration and runtime behavior

## Impact

- **Documentation**: 6 MDX guide pages, 2 demo scenario components (574 lines added, 81 removed)
- **Users**: Platform builders integrating with Stigmer federation now have complete documentation for all three provisioning modes
- **Design decisions**: DD-001 (separate identity/authorization), DD-003 (fail-closed tenant resolution), DD-004 (SSO/JIT mutual exclusion) are all reflected in the documentation

## Related Work

- T01-T07: Backend implementation of JIT provisioning (proto, backend, validation, testing)
- Design decisions DD-001 through DD-004 in `_projects/2026-04/20260416.01.jit-provisioning/design-decisions/`

---

**Status**: Production Ready
**Timeline**: Session 6 of the jit-provisioning project
