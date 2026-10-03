# IdentityProvider Validation Checklist and Common Pitfalls

Pre-create checklist and known pitfalls when registering an IdentityProvider.

## Pre-Create Checklist

### Required Fields

- [ ] `apiVersion` is exactly `iam.stigmer.ai/v1`
- [ ] `kind` is exactly `IdentityProvider`
- [ ] `metadata.name` is present and descriptive
- [ ] `metadata.org` is set to the organization that owns this identity provider
- [ ] `metadata.slug` follows the slug format: lowercase alphanumeric with hyphens, starts with a letter, 1–63 characters

### Spec Validation

- [ ] `spec.jwks_uri` is an HTTPS URL pointing to the provider's JWKS endpoint
- [ ] `spec.jwks_uri` is reachable from Stigmer's servers (publicly accessible)
- [ ] `spec.jwks_uri` is the `jwks_uri` that each issuer's OIDC discovery document names
- [ ] `spec.allowed_issuers` contains at least one entry
- [ ] Each entry in `spec.allowed_issuers` names the same issuer as the `iss` claim in tokens from this provider, path included (copy it from the provider's OIDC discovery document)
- [ ] `spec.expected_audience` exactly matches the `aud` claim in tokens (copy directly from the provider's configuration)
- [ ] `spec.expected_audience` is your organization's own registration at the issuer (an API identifier or client ID), not a value shared with others
- [ ] `spec.userinfo_endpoint`, if set, is an HTTPS URL pointing to the OIDC UserInfo endpoint
- [ ] `spec.userinfo_endpoint`, if set, accepts a Bearer token and returns standard OIDC profile claims

### Authorization

- [ ] The calling identity has `can_create_idp` on the owning organization

## Common Pitfalls

### Mismatched `allowed_issuers`

The `iss` claim in the token must name one of the issuers in `allowed_issuers`. Stigmer compares issuers in canonical form, so a trailing slash, the case of the scheme and host, and a default port make no difference; the path does. An Okta custom authorization server, for one, is an issuer with a path, and the bare domain is a different issuer.

```yaml no-validate="a wrong and a right value side by side"
# Wrong — the domain alone; the tokens' iss carries the authorization server's path
allowed_issuers:
  - "https://acme.okta.com"

# Correct — the issuer the tokens name
allowed_issuers:
  - "https://acme.okta.com/oauth2/default"
```

To find the value, check the token's `iss` claim or the `issuer` field of the provider's OpenID Connect discovery document (`{issuer}/.well-known/openid-configuration`). The save reads that document, and refuses an issuer whose document names another.

### Mismatched `expected_audience`

The `aud` claim must exactly match `expected_audience`. This value is the API identifier configured in Auth0, not the Auth0 tenant URL.

```yaml no-validate="a wrong and a right value side by side"
# Wrong — using the tenant URL as audience
expected_audience: "https://my-tenant.us.auth0.com/"

# Correct — using the API identifier
expected_audience: "https://api.myplatform.com/"
```

### A Shared or Borrowed `expected_audience`

An issuer and an audience together identify an identity provider across the platform, so an audience another identity provider already registered at the same issuer is refused with `ALREADY_EXISTS`. Register an API identifier or client ID of your own for Stigmer at the issuer. The audience also cannot be a URL the issuer's discovery document names, such as its userinfo endpoint, because the issuer may add that audience to every token it mints.

### Endpoints That Are Not the Issuer's Own

Stigmer reads each issuer's discovery document when the identity provider is saved, and refuses a `jwks_uri` or `userinfo_endpoint` other than the one it names. Copy both values from the discovery document rather than from another deployment.

### Using an HTTP (Non-HTTPS) Endpoint

All endpoints (`jwks_uri`, `userinfo_endpoint`) must use HTTPS. Stigmer rejects plain HTTP endpoints.

```yaml no-validate="a wrong and a right value side by side"
# Wrong
jwks_uri: "http://auth.example.com/.well-known/jwks.json"

# Correct
jwks_uri: "https://auth.example.com/.well-known/jwks.json"
```

### Registering a Non-Public JWKS Endpoint

The `jwks_uri` must be reachable from Stigmer's servers. Stigmer fetches the key set when the identity provider is saved and refuses the save with `INVALID_ARGUMENT` when it cannot read it, so a private network URL (e.g., `https://internal.example.com/jwks`) is never stored.

### Using the Wrong Endpoint for `userinfo_endpoint`

The UserInfo endpoint must comply with OpenID Connect Core 1.0 §5.3 — it must accept a Bearer token and return a JSON object with at least the `sub` claim. Passing a generic user API endpoint that requires a different auth scheme will fail.

For Auth0, the UserInfo endpoint is always `https://{tenant}.auth0.com/userinfo`.

### Deleting a Provider With Active Federated Accounts

Deleting an IdentityProvider that still has platform-managed organizations referencing it is blocked. Reassign or remove those references before deletion.

Deleting an IdentityProvider also deletes the federated accounts it vouches for, with every role they hold, and its tenant organization mappings. A provider created again under the same slug inherits none of them: nothing the old provider's users held carries over.

### Expecting `rate_limit_budget` to Throttle

No server enforces `rate_limit_budget`. A value is accepted and stored, and it has no effect on sign-in or on request rates, so do not rely on it to protect a downstream service.
