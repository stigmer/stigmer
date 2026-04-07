# Improve Identity Provider Registration Provider Guidance

**Date**: April 7, 2026

## Summary

Rewrote the "Finding these values for common providers" section of the Register an Identity Provider documentation page. The previous single-accordion wall of text was hard to scan; it now uses per-provider accordions with structured tables, step-by-step console navigation, and links to official documentation from Auth0, Okta, Microsoft Entra ID, and AWS Cognito.

## Problem Statement

The existing provider guidance buried JWKS URI, issuer, and audience information in run-on paragraphs inside a single accordion. Readers had to parse dense text to extract the three values they needed, with no links to the upstream provider docs for further help.

### Pain Points

- All four providers crammed into a single accordion—easy to miss provider-specific details
- No structured layout; each value was embedded in prose rather than presented in a scannable table
- No links to official provider documentation—users had to search on their own
- No mention of the universal `.well-known/openid-configuration` discovery endpoint

## Solution

Restructured the section into four separate accordions (one per provider) with a consistent format: console navigation instructions, a three-row table mapping each value to where to find it, a discovery URL for verification, and links to the provider's official docs.

## Implementation Details

- Added a `<Callout type="tip">` above the accordions explaining the universal `.well-known/openid-configuration` endpoint that works across all OIDC providers
- Split the single `<Accordion>` into four: Auth0, Okta, Microsoft Entra ID, AWS Cognito
- Each accordion follows the same structure:
  1. Opening sentence with a link to the provider's admin console and where to navigate
  2. Three-row table: JWKS URI, Issuer, Audience → "How to find it"
  3. Discovery URL the reader can open in their browser to verify
  4. Links to 2–3 official documentation pages
- Replaced `e.g.` with `for example` to satisfy the project's Vale style rules

## Benefits

- Faster time-to-value: readers can scan a table instead of parsing paragraphs
- Direct links to upstream docs reduce friction for first-time integrators
- Universal discovery endpoint tip applies to any OIDC provider, not just the four listed
- Consistent accordion structure makes it easy to add more providers later

## Impact

Affects the documentation site only (`docs/guides/federation/register-identity-provider.mdx`). No backend, SDK, or API changes.

---

**Status**: ✅ Production Ready
