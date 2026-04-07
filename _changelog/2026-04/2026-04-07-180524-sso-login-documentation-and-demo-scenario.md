# SSO Login Documentation and Interactive Demo Scenario

**Date**: April 7, 2026

## Summary

Completed Phase 6 (Documentation) of the SSO login flow sub-project, delivering a comprehensive "Set up SSO" how-to guide, updated federation documentation across four existing pages, regenerated SDK reference for new lifecycle RPCs, and built an interactive 4-step `sso-login-playback` demo scenario that walks readers through the admin-to-user SSO journey.

## Problem Statement

With the SSO login flow fully implemented (Phases 1–5: proto definitions, backend handlers, auto-provisioning, web app login page, and IdP detail panel), the documentation had not been updated to reflect these capabilities. Users and org admins had no guide for enabling SSO, existing federation docs did not mention the SSO path, and the new `updateFederatedAccount` and `deprovisionFederatedAccount` RPCs were not documented.

### Pain Points

- No dedicated SSO setup guide — org admins had to reverse-engineer the flow from API specs
- Existing federation overview only described platform-managed federation, ignoring the self-managed SSO path
- Authentication flow documentation did not explain what happens when an SSO user has no pre-existing account
- Provision federated accounts guide lacked update and revocation instructions
- SDK reference pages did not include the two new lifecycle RPCs
- No interactive demo for the SSO login flow, unlike other federation guides which all have playback scenarios

## Solution

Created a new SSO how-to guide as the authoritative reference for org admins, updated four existing federation pages to integrate SSO context, regenerated SDK reference docs, and built an interactive demo scenario following the established `ScenarioPlayer` pattern.

## Implementation Details

### New SSO Guide (`sso-login.mdx`)

A Diataxis how-to guide structured around the org admin audience:

- **How SSO login works** — Mermaid sequence diagram showing the one-time setup and per-login flow
- **Prerequisites** — self-managed org, OIDC-compatible IdP, client application requirements
- **Configure your Identity Provider** — settings table (callback URL, logout URL, grant type), audience handling callout
- **Register with SSO enabled** — SDK examples in TypeScript, Go, Python, Java with `isSsoProvider` and `oidcClientId` fields
- **Share the SSO login URL** — how the URL is constructed and where to find it
- **First login behavior** — 4-step auto-provisioning walkthrough, why viewer role (not member)
- **Manage SSO users** — role upgrade and revocation patterns with SDK examples
- **Troubleshooting** — 4 common issues with diagnostic steps

### Updated Federation Pages

- **`overview.mdx`** — Introduced "Platform-managed federation" and "Self-managed SSO" as two distinct paths; added SSO card link
- **`provision-federated-accounts.mdx`** — Added "Update a federated account" and "Revoke a federated account" sections with SDK examples in all 4 languages; added SSO vs platform-managed callout
- **`authentication-flow.mdx`** — Updated identity resolution to describe SSO auto-provisioning path; added SSO login flow Mermaid diagram; updated 401 troubleshooting for SSO context

### SDK Reference

- Regenerated `identity-account.mdx` via `make gen-sdk-docs` — `updateFederatedAccount` and `deprovisionFederatedAccount` now documented with parameters, return types, and examples

### Interactive Demo Scenario (`sso-login-playback`)

A 4-step `ScenarioPlayer` playback:

1. **IdP detail panel** (ManagementShell) — SSO badge, OIDC fields, copyable SSO Login URL with pulsing cursor on Copy button
2. **SSO login page** (BrowserView) — org discovery, "Sign in with Acme SSO" button with pulsing cursor
3. **External IdP login** (BrowserView) — Acme Identity branding, pre-filled email/password form
4. **Console welcome** (BrowserView) — checkmark, "Welcome, Jane!", role/org info card showing viewer role and first-login provisioning

Each step uses static mock content (consistent with existing federation demos where backend state is needed).

### Vale Linting

- Rephrased "auto-" compounds to "creates automatically" / "automatic provisioning" across all modified docs
- Renamed "Deprovision a federated account" heading to "Revoke a federated account"
- Fixed capitalization and terminology flags

## Benefits

- **Complete SSO documentation** — org admins have a single, authoritative guide from IdP setup through troubleshooting
- **Visual learning** — the interactive demo shows the full SSO journey in 4 steps, matching the pattern established by other federation guides
- **Federation doc coherence** — existing pages now acknowledge and cross-link the SSO path, eliminating gaps
- **SDK reference parity** — all lifecycle RPCs are now documented with examples in 4 languages
- **Zero lint errors** — all modified documentation passes Vale linting clean

## Impact

- **Org admins** gain a clear path to enable SSO for their teams
- **Platform developers** understand the relationship between platform-managed federation and self-managed SSO
- **New users** landing on the federation overview see both options upfront
- **Documentation maintainers** have consistent cross-links and a demo scenario that follows established patterns

## Related Work

- Phase 1–5 implementation (proto, backend, auto-provisioning, web app, IdP panel) across previous sessions
- Existing federation demo scenarios: `register-idp-playback`, `provision-grant-playback`, `authentication-flow-playback`, `federation-overview-tour`, `multi-tenant-setup-playback`
- Parent project: `20260405.02.identity-provider-flow`

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (Phase 6 of T01)
