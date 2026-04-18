# IdentityProvider: Add OIDC-Standard `userinfo_endpoint` Field

**Date**: February 20, 2026

## Summary

Added `userinfo_endpoint` to `IdentityProviderSpec` — the OIDC-standard field name for the UserInfo endpoint URL. This completes the proto layer for Phase 1 of the Stigmer × Planton integration. The field corrects the original design note's proposed name (`userinfo_uri`) to the canonical name registered in the OIDC Discovery 1.0 specification. Documentation throughout the spec was also updated to reflect the revised Session 2 architecture.

## Problem Statement

The Session 2 architecture design established that during token exchange, Stigmer must call the OIDC UserInfo endpoint to fetch the user's email, name, and picture — profile data that Auth0 access tokens do not carry by default. The `IdentityProviderSpec` proto was missing this field. The design notes had proposed naming it `userinfo_uri`, but the OIDC specification has a precise, well-known name for this metadata field.

### Pain Points

- Missing field: no way to configure the UserInfo endpoint per IdentityProvider
- Incorrect proposed name (`userinfo_uri`): would diverge from the OIDC standard, making the API less intuitive to any developer familiar with OIDC
- Stale Session 1 documentation: the spec's message comment and YAML example still described the discarded Session 1 architecture (custom RSA key pairs, GitHub Pages JWKS, custom JWT minting), misleading any implementor

## Solution

Added `userinfo_endpoint` (field number 6) to `IdentityProviderSpec` using the exact metadata field name from OIDC Discovery 1.0 Section 3 — registered in the IANA OpenID Provider Metadata registry. This makes `IdentityProviderSpec` a coherent set of three OIDC-standard configuration fields: `jwks_uri`, `userinfo_endpoint`, and `allowed_issuers`/`expected_audience` for audience binding.

Existing `jwks_uri` (field 2) already used the OIDC Discovery 1.0 standard name — `userinfo_endpoint` is its natural companion.

## Implementation Details

### File Changed: `apis/ai/stigmer/iam/identityprovider/v1/spec.proto`

**New field added (field 6):**

```protobuf
// OIDC UserInfo endpoint URL for fetching user profile data during token exchange.
// Stigmer calls this endpoint with the platform's access token (as a Bearer token)
// to retrieve the user's email, name, and picture for the federated identity account.
// Profile data is updated on every token exchange to keep it fresh.
//
// This is the standard "userinfo_endpoint" metadata field defined in
// OpenID Connect Discovery 1.0 (Section 3). The endpoint itself is specified in
// OpenID Connect Core 1.0 (Section 5.3).
//
// For Auth0-based integrators: https://{tenant}.auth0.com/userinfo
string userinfo_endpoint = 6 [(buf.validate.field).string.max_len = 2048];
```

**Documentation updates in the same file:**

- **Message-level comment**: Replaced Session 1's "direct JWT assertion validation" description with the Session 2 token exchange flow (validate → UserInfo → JIT provision → issue Stigmer token)
- **Example YAML**: Updated to reflect Session 2 real values — Auth0 JWKS URL, Auth0 tenant issuer URL, Auth0 API identifier as audience, Auth0 UserInfo URL
- **`jwks_uri` field comment**: Updated from "platform publishes its own signing keys" to "OIDC provider's standard JWKS endpoint"; added spec citation (OIDC Discovery 1.0 Section 3, RFC 7517)
- **`allowed_issuers` field comment**: Added Auth0 tenant URL as the concrete example
- **`expected_audience` field comment**: Added Auth0 API identifier as the concrete example

### Why `userinfo_endpoint` not `userinfo_uri`

The OIDC Discovery 1.0 specification (Section 3) defines the field as `userinfo_endpoint` — the same document that defines `jwks_uri`. Using the spec-exact names means any developer who has worked with OIDC will immediately recognize both fields. The `_endpoint` suffix also communicates intent more clearly than `_uri`: it is not just a URL, it is a callable service endpoint with a defined protocol (Bearer token, GET request, JSON response).

### How it works at runtime

```
Token Exchange Endpoint receives: external JWT from Auth0
    ↓
Validate JWT signature using jwks_uri (Auth0's /.well-known/jwks.json)
    ↓
Validate iss ∈ allowed_issuers, aud == expected_audience
    ↓
Call userinfo_endpoint with Authorization: Bearer <access_token>
    ↓
Extract email, name, picture from UserInfo JSON response
    ↓
JIT provision or update federated identity_account
    ↓
Issue Stigmer-native token
```

### Stubs regenerated

- `apis/stubs/go/ai/stigmer/iam/identityprovider/v1/spec.pb.go` — Go field: `UserinfoEndpoint string`
- `apis/stubs/python/stigmer/ai/stigmer/iam/identityprovider/v1/spec_pb2.py` / `spec_pb2.pyi` — Python field: `userinfo_endpoint`

## Benefits

- **Spec-compliant naming**: Any OIDC-knowledgeable developer sees `jwks_uri` and `userinfo_endpoint` and immediately knows what to configure, without reading documentation
- **Accurate documentation**: The spec file now correctly documents the Session 2 architecture; future implementors of `stigmer-cloud` have the right mental model from the proto
- **Complete MVP proto layer**: All four configuration fields needed for Phase 1 are now in place — `jwks_uri`, `userinfo_endpoint`, `allowed_issuers`, `expected_audience`

## Impact

- **stigmer-cloud implementors** (Phase 1 next): the `IdentityProviderSpec` is now complete and correctly documented; the token exchange implementation can reference the spec as ground truth
- **Proto consumers** (Go SDK, Python stubs): `UserinfoEndpoint` field available immediately; backward compatible (additive, field 6)
- **API surface**: no breaking changes; `userinfo_endpoint` is optional, same as all other spec fields

## Related Work

- Session 1 checkpoint: `checkpoints/2026-02-19-session-1.md` — IdentityProvider proto initial design
- Session 2 checkpoint: `checkpoints/2026-02-19-session-2.md` — Architecture revised to token exchange + Auth0 JWKS
- Next: `stigmer-cloud` IdentityProvider CRUD implementation (controller, Temporal workflow, MongoDB repo, FGA tuples)
- Project: `20260218.01.stigmer-planton-integration`

---

**Status**: Production Ready (proto layer)
**Timeline**: Session 3, 2026-02-20
