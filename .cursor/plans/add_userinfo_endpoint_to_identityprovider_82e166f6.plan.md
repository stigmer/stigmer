---
name: Add userinfo_endpoint to IdentityProvider
overview: Add the OIDC-standard `userinfo_endpoint` field to `IdentityProviderSpec` proto and update stale Session 1 documentation to reflect Session 2's revised architecture (Auth0 JWKS, token exchange flow).
todos:
  - id: add-userinfo-field
    content: Add `userinfo_endpoint` field (number 6) to `IdentityProviderSpec` in spec.proto with OIDC-standard naming, validation, and documentation
    status: completed
  - id: update-stale-docs
    content: Update stale Session 1 comments and YAML example in spec.proto to reflect Session 2 architecture (Auth0 JWKS, token exchange flow)
    status: completed
  - id: regen-stubs
    content: Regenerate Go and Python stubs via `make build` in apis/
    status: completed
isProject: false
---

# Add `userinfo_endpoint` to IdentityProvider Proto

## Background: The OIDC Standard

The **UserInfo Endpoint** is defined in **OpenID Connect Core 1.0, Section 5.3**. It is an OAuth 2.0 protected resource accessed with a Bearer token:

```
GET /userinfo HTTP/1.1
Host: planton-prod.us.auth0.com
Authorization: Bearer <access_token>
```

Returns JSON with standard claims: `email`, `name`, `picture`, `sub`, etc.

The canonical metadata field name is `**userinfo_endpoint**` -- registered in **OIDC Discovery 1.0, Section 3** (IANA OpenID Provider Metadata registry). This matches our existing `jwks_uri` field which also uses the exact OIDC Discovery spec name. The Session 2 design notes called it `userinfo_uri` -- we correct this to `userinfo_endpoint` per the spec.

## What Changes

**One file** to edit: [apis/ai/stigmer/iam/identityprovider/v1/spec.proto](apis/ai/stigmer/iam/identityprovider/v1/spec.proto)

### 1. Add `userinfo_endpoint` field (field number 6)

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

- **Name**: `userinfo_endpoint` (exact OIDC Discovery 1.0 metadata name)
- **Type**: `string` with `max_len = 2048` (same as `jwks_uri`)
- **Field number**: 6 (next available)
- **Required?**: No -- optional, same as `jwks_uri`. Some future integrators may not have a UserInfo endpoint (Stigmer would skip profile fetching).

### 2. Update stale Session 1 documentation in the same file

The existing comments and YAML example reflect Session 1's architecture (custom RSA key pairs, GitHub Pages JWKS, custom JWT minting). Since Session 2 revised this significantly, the documentation is misleading. Changes:

- **Message-level comment**: Update to describe token exchange flow (not direct JWT assertion validation)
- **Example YAML**: Change `jwks_uri` from `https://api.planton.ai/.well-known/stigmer-jwks.json` to `https://planton-prod.us.auth0.com/.well-known/jwks.json`, add `userinfo_endpoint`, update `allowed_issuers` to Auth0's issuer URL, update `expected_audience` to Auth0's API identifier
- `**jwks_uri` field comment**: Update from "platform publishes its signing keys" to "OIDC provider's standard JWKS endpoint"
- `**allowed_issuers` field comment**: Add Auth0 tenant URL example
- `**expected_audience` field comment**: Add Auth0 API identifier example

### 3. Regenerate stubs

```bash
cd apis && make build
```

This runs `buf lint`, `buf format`, generates Go stubs (`stubs/go/`) and Python stubs (`stubs/python/`). No Java stubs are generated from this repo (stigmer-cloud consumes protos via buf BSR or similar).

## What Does NOT Change

- No field numbers on existing fields change (backward compatible)
- No structural changes to the message (just one new field + updated comments)
- No changes to other proto files (api.proto, status.proto, enum.proto, io.proto, etc.)
- No changes to the Organization proto or any other resource

