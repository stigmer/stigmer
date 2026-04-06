# Remove Internal Company References from IdP SDK Components

**Date**: April 6, 2026

## Summary

Cleaned up all placeholder text and JSDoc examples in the Identity Provider SDK React components that referenced an internal company name. Replaced with generic "Acme Corp SSO" examples appropriate for a public SDK.

## Problem Statement

### Pain Points

- SDK components contained hardcoded "Planton Cloud" in placeholder text and code examples
- Internal company names in public SDK components look unprofessional and confuse platform builders
- JSDoc examples should use generic, relatable names

## Solution

Replaced all occurrences across 5 files with generic "Acme Corp SSO" / "acme" references — covering input placeholders, JSDoc `@example` blocks, and inline documentation.

## Implementation Details

- `IdentityProviderDetailPanel.tsx` — display name input placeholder
- `IdentityProviderWizard.tsx` — display name input placeholder
- `CreateIdentityProviderForm.tsx` — name input placeholder
- `useCreateIdentityProvider.ts` — JSDoc example (name, org, jwksUri, allowedIssuers)
- `useUpdateIdentityProvider.ts` — JSDoc example (name, slug, org, displayName)

## Impact

All platform builders consuming `@stigmer/react` will see clean, generic examples when using the IdP management components.

## Related Work

- Follows Phase 7 (IdP management pages with guided wizard) from the identity-provider-flow project

---

**Status**: ✅ Production Ready
