# Identity Provider Management Pages with Guided Creation Wizard

**Date**: April 6, 2026

## Summary

Built the web console Identity Provider management pages with a guided creation wizard that auto-populates OIDC configuration from provider presets. Instead of a manual form requiring 6+ fields, org admins now pick their provider (Auth0, Okta, Google, Entra ID, AWS Cognito) from a grid, enter 1-2 provider-specific values, and the wizard constructs the full OIDC trust configuration automatically. Full CRUD is supported: list, create (wizard), view/edit (detail panel), and delete.

## Problem Statement

Phase 6 of the identity provider flow built the React SDK hooks and basic components (`IdentityProviderListPanel`, `CreateIdentityProviderForm`), but there was no web console page to use them. Org admins had no UI to manage identity providers.

### Pain Points

- No settings page for identity provider management
- The flat creation form (`CreateIdentityProviderForm`) required manually entering JWKS URI, allowed issuers, expected audience, and userinfo endpoint — error-prone and unfamiliar to most admins
- No way to view or edit existing identity provider configuration
- No entry point in the management sidebar navigation

## Solution

Built the management pages following the SDK-first architecture: new components in `@stigmer/react` (reusable by platform builders), then a thin Console page that wires routing and org context.

The key innovation is **template-based provider presets**: for 5 well-known providers, the OIDC URLs are deterministic — given a tenant name (Auth0), org domain (Okta), or tenant ID (Entra ID), the JWKS URI, issuer, and userinfo endpoint can be constructed without any network call. Only the "Custom OIDC" path uses browser-side OIDC Discovery (with graceful CORS fallback).

## Implementation Details

### SDK React Layer (5 new files in `sdk/react/src/identity-provider/`)

**`presets.ts`** — Pure data defining 6 provider presets (Auth0, Okta, Google, Microsoft Entra ID, AWS Cognito, Custom OIDC). Each preset has a `buildConfig(vars)` function that constructs `jwksUri`, `issuer`, `allowedIssuers`, and `userinfoEndpoint` from user input. Google requires zero variables (all static). Auth0 needs tenant + region. Okta needs the org domain.

**`useOidcDiscovery.ts`** — Imperative behavior hook that fetches `{issuer}/.well-known/openid-configuration` from the browser. Returns a `discover()` function (not effect-based) since it's triggered by user action. On CORS failure, provides actionable error messages guiding the user to enter configuration manually.

**`ProviderPicker.tsx`** — Responsive 3-column grid (2 on mobile) of provider cards. Each card has a thematic SVG icon, label, and description. Custom OIDC uses a dashed border to signal a different flow. Keyboard accessible with ARIA listbox semantics.

**`IdentityProviderWizard.tsx`** — 3-step creation flow:
1. Pick provider (ProviderPicker)
2. Configure (provider-specific variables + display name + expected audience)
3. Review (auto-populated fields, all editable for power users, SSO toggle)

For known presets, the step 2 → 3 transition is instant (template computation). For Custom OIDC, it triggers async OIDC Discovery with a loading state, then proceeds to review with discovered (or empty) fields.

**`IdentityProviderDetailPanel.tsx`** — View/edit component for existing IdPs. View mode shows structured label/value pairs (JWKS URI, issuers, audience, SSO status, timestamps). Edit mode turns fields into editable inputs. Uses `useUpdateIdentityProvider()` for save.

### Console Layer

- **ManagementSidebar**: Added "Identity Providers" nav item with `ShieldCheck` icon, positioned after Environments
- **Route**: `/settings/identity-providers` page rendering `IdentityProvidersSection`
- **Section**: Follows `ApiKeysSection` pattern with `idle|creating|editing` flow state, `useResourceAvailable` gate for cloud-only mode

## Benefits

- **Reduced friction**: Creating an Auth0 IdP goes from filling 6 fields to entering a tenant name and region — the wizard does the rest
- **Error reduction**: Template-based URL construction eliminates typos in JWKS URIs and issuer values
- **CORS-free for common cases**: The 5 popular providers use templates, not network discovery, avoiding browser CORS issues entirely
- **Platform builder reusable**: All components live in `@stigmer/react` — platform builders embedding IdP admin in their own dashboards get the same guided experience
- **Backward compatible**: `CreateIdentityProviderForm` (flat form) is kept alongside the wizard — platform builders choose their preferred abstraction level

## Impact

- **Org admins**: Can now manage identity providers from the settings UI instead of API-only
- **Platform builders**: Get a reusable `IdentityProviderWizard` component with `ProviderPicker` and `IdentityProviderDetailPanel` for embedding
- **SDK surface**: 5 new exports from `@stigmer/react` (3 components, 1 data constant, 1 utility function) plus their TypeScript types

## Related Work

- Phase 6: Identity Provider React SDK (hooks + basic components) — this session's foundation
- Phase 4: Self-Managed SSO Data Model (`is_sso_provider`, `oidc_client_id` on IdP spec)
- Settings Layout Refactor project (20260405.03) — the management zone this page lives in
- Phase 8 (upcoming): Federation flow documentation for platform builders

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
