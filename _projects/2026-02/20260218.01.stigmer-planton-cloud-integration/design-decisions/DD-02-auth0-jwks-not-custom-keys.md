# DD-02: IdentityProvider Points to Auth0's Public JWKS (No Custom Keys)

**Date**: 2026-02-19
**Status**: Approved
**Supersedes**: Session 1 design (custom RSA key pair + JWKS on GitHub Pages)

## Decision

For Auth0-based integrators, the IdentityProvider's `jwks_uri` points directly to Auth0's `.well-known/jwks.json`. No custom key pairs, no JWKS publishing, no key rotation infrastructure.

## Context

Session 1 proposed that Planton generate custom RSA keys, publish JWKS on GitHub Pages, and the proxy mint custom JWTs. During Session 2, we realized that with token exchange, the external JWT only goes to the exchange endpoint (not API endpoints), so using Auth0's existing JWKS is both simpler and more secure.

## Consequences

- Eliminates: private key generation, GitHub Pages JWKS, JWT minting code, key rotation
- Auth0 handles key rotation automatically
- IdentityProvider config: `jwks_uri = https://planton-prod.us.auth0.com/.well-known/jwks.json`
- For future non-Auth0 integrators, the custom JWKS path remains available

## What Stays in IdentityProvider

- `jwks_uri` — Auth0's public JWKS URL
- `userinfo_uri` — Auth0's UserInfo endpoint
- `allowed_issuers` — Auth0 tenant issuer URL
- `expected_audience` — the integrator's API audience (e.g., `https://api.planton.ai/`)
