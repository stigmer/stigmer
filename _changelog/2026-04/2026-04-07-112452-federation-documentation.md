# Identity Federation Documentation

**Date**: April 7, 2026

## Summary

Added comprehensive identity federation documentation to the Stigmer docs site. Created a new top-level "Guides" section with a multi-page federation guide, plus a new "Identity" concepts page. This completes Phase 8 of the identity provider flow project.

## Problem Statement

The identity federation feature (Phases 1–7) introduced Identity Providers, federated accounts, IAM policies for federated users, SSO data model, React SDK components, and web app management pages — but none of it was documented for platform builders. The auto-generated SDK reference pages cover the API surface, but there was no narrative documentation explaining *when*, *why*, or *in what order* to use these APIs.

### Pain Points

- Platform builders had no guide for integrating their own identity system with Stigmer
- The relationship between Identity Providers, federated accounts, and IAM policies wasn't explained
- No troubleshooting guidance for common authentication errors (401 vs 403)
- The existing Getting Started section covers "zero to first agent" — identity federation is a different audience moment

## Solution

Created a new "Guides" top-level section in the docs sidebar for task-oriented, multi-step integration content. Identity federation is the first guide, spanning five focused pages plus a lightweight concepts page.

## Implementation Details

### New concepts page: `docs/concepts/identity.mdx`
- Explains the three account types (direct, federated, machine)
- Describes Identity Providers as trust relationships, not user databases
- Includes a sequence diagram of the federated authentication flow
- Covers authorization basics (IAM Policies: WHO + WHAT + HOW)
- Links forward to the federation guide and SDK reference pages

### New "Guides" section: `docs/guides/`
- New top-level sidebar section between Concepts and SDK Reference
- `meta.json` files control ordering in Fumadocs sidebar
- Designed to host future multi-page guides (webhooks, workflows, etc.)

### Federation guide: `docs/guides/federation/` (5 pages)

1. **overview.mdx** — Architecture diagram (Mermaid flowchart), prerequisites, guide structure with card navigation
2. **register-identity-provider.mdx** — Step-by-step IdP creation with 4-language SDK examples (TypeScript, Go, Python, Java), field reference table, provider-specific instructions for Auth0/Okta/Entra ID/Cognito in an accordion
3. **provision-federated-accounts.mdx** — Check-then-create pattern (`getByExternalSub` + `createFederatedAccount`), explanation of `externalSub` and uniqueness constraints, complete provisioning handler example in all 4 languages
4. **grant-access.mdx** — IAM Policy creation for federated users, complete onboarding flow combining provisioning + role grant, revocation with `revokeOrgAccess`
5. **authentication-flow.mdx** — End-to-end sequence diagram (10-step Mermaid), token requirements table, error response diagnosis (401 vs 403), troubleshooting checklist using Steps component, SDK examples for initializing clients with user JWTs

### Modified files
- `docs/meta.json` — Added `"guides"` to top-level pages array
- `docs/concepts/meta.json` — Added `"identity"` after `"organizations"`

### Documentation conventions followed
- All pages have `title` and `description` front matter
- Second person ("you"), active voice, contractions
- Sentence casing for headings
- `<SDKTabs>`, `<Callout>`, `<Mermaid>`, `<Cards>`, `<Steps>`, `<Accordions>` components
- Links to SDK reference pages instead of duplicating API surface
- Style guide compliance (STYLE.md)

## Benefits

- Platform builders have a clear, step-by-step path to integrate federated identity
- Each page is self-contained — readers can jump to exactly what they need
- Troubleshooting section reduces support burden for common auth errors
- Guide structure is extensible for future content (SSO, webhooks, etc.)
- Concepts page bridges the gap between "Organizations" and the detailed guide

## Impact

- **Docs site**: New sidebar section visible to all docs visitors
- **Platform builders**: Can now self-serve federated identity integration
- **Docs architecture**: Establishes the "Guides" pattern for future task-oriented content
- **8 new files**, **2 modified files**, ~1400 lines of documentation

## Related Work

- Identity Provider Flow project (Phases 1–7): `_projects/2026-04/20260405.02.identity-provider-flow/`
- Auto-generated SDK reference: `docs/sdk/resources/identity-provider.mdx`, `docs/sdk/resources/identity-account.mdx`, `docs/sdk/resources/iam-policy.mdx`
- React SDK docs: `docs/sdk/react/identity-provider.mdx`

---

**Status**: ✅ Production Ready
**Timeline**: Phase 8 of the identity provider flow project
