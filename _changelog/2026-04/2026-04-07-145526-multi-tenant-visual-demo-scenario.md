# Multi-Tenant Visual Demo Scenario

**Date**: April 7, 2026

## Summary

Added an interactive visual demo scenario to the multi-tenant platform setup guide, bringing it to visual parity with all other federation documentation pages. The scenario walks readers through the complete two-phase multi-tenant onboarding flow using BrowserView, CodeEditorView, and TerminalView.

## Problem Statement

The multi-tenant platform setup page was the only federation guide page without an interactive ScenarioPlayer demo. While all other federation guides (overview, register IdP, provision accounts, grant access, authentication flow) led with animated visual walkthroughs, the multi-tenant page relied on two static Mermaid diagrams. This created an inconsistency in the documentation experience.

### Pain Points

- Multi-tenant setup page was visually inconsistent with the rest of the federation guide section
- The two-phase onboarding story (tenant creation + per-tenant user provisioning) was harder to follow in text form
- The key differentiators from single-org federation (platform-managed mode, external org ID mapping, tenant isolation) were buried in code blocks
- No video export was possible for the multi-tenant guide

## Solution

### New scenario: `multi-tenant-setup-playback`

A 7-step animated playback with two distinct phases, matching the page's narrative structure:

**Phase 1 — Tenant onboarding (steps 1–3):**
1. BrowserView: Platform admin panel showing "Create tenant" action
2. CodeEditorView: `organization.create` SDK call with `managementMode`, `identityProviderRef`, and `externalOrgId` highlighted
3. TerminalView: Tenant org created with external ID mapping

**Phase 2 — User onboarding within tenant (steps 4–7):**
4. BrowserView: Tenant-branded signup form (Jane Doe on Tenant Alpha's portal)
5. CodeEditorView: `getByExternalOrgId` lookup bridging platform tenant ID to Stigmer org
6. CodeEditorView: `createFederatedAccount` targeting the tenant org + IAM Policy grant
7. TerminalView: Full onboarding complete with tenant isolation confirmation

### Inline page components

Two BrowserView content components make the two phases visually distinct:

- **TenantAdminPage**: Platform admin panel with tenant organization list, status badges (Provisioning/Active), and a "Create tenant" button with cursor target and pulse highlight
- **TenantSignupPage**: Tenant-branded signup form with Building2 icon, pre-filled form fields, and cursor-targeted submit button

### Narration

All 7 steps include narration scripts for TTS generation, using the SDK how-to register (precise, assumes federation familiarity). Narration emphasizes what's different from single-org federation at each step.

## Implementation Details

### New files

- `site/src/components/docs/demos/scenarios/multi-tenant-setup-playback/steps.ts` — `MultiTenantSetupStep` discriminated union type, three code snippet fixtures (`CREATE_ORG_CODE`, `LOOKUP_ORG_CODE`, `PROVISION_GRANT_CODE`), two terminal output fixtures, and the 7-step sequence with captions and narration
- `site/src/components/docs/demos/scenarios/multi-tenant-setup-playback/index.tsx` — `MultiTenantSetupPlayback` component with ScenarioPlayer, cursor wiring for the two BrowserView steps, file tree with `onboard-tenant.ts` and `onboard-tenant-user.ts`, and view rendering switch

### Modified files

- `site/src/components/docs/demos/scenarios/registry.ts` — Registered for video export
- `site/src/components/docs/index.ts` — Barrel export as `DemoMultiTenantSetupPlayback`
- `site/src/components/mdx.tsx` — Added to MDX component map
- `docs/guides/federation/multi-tenant-setup.mdx` — Embedded `<DemoMultiTenantSetupPlayback />` after intro paragraph

### Pattern consistency

The scenario follows the exact architecture established by the other federation demos:
- Same `ScenarioPlayer` + `useNarrationManifest` + `Cursor` composition pattern
- Same view components (BrowserView, CodeEditorView, TerminalView)
- Same `DEMO_PLAYER_CLASSES` wrapper
- Same inline page component pattern for BrowserView content (cf. `SignupPage` in `provision-grant-playback`)
- Same cursor target convention (`data-cursor-target` + `PulseHighlight`)

## Benefits

- All 6 federation guide pages now have interactive demos — no more visual gaps
- The two-phase story arc (tenant → user) is visually distinct through BrowserView transitions
- Key multi-tenancy differentiators (`platform_managed`, `externalOrgId`, tenant-scoped provisioning) are visually highlighted in the code editor steps
- Scenario is registered for video export via Remotion

## Impact

- **Documentation**: Federation guide section achieves full visual parity — every page has an animated walkthrough
- **Consistency**: Multi-tenant page now follows the same demo-first structure as all other federation guides
- **Video pipeline**: New scenario available for automated video export

## Related Work

- [Multi-Tenancy Documentation and Navigation Ordering](2026-04-07-144243-multi-tenancy-documentation-and-navigation-ordering.md)
- [Federation Visual Scenarios and Interaction Framework](2026-04-07-141850-federation-visual-scenarios-and-interaction-framework.md)
- [Federation Documentation](2026-04-07-112452-federation-documentation.md)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
