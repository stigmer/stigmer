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
- [ ] `spec.allowed_issuers` contains at least one entry
- [ ] Each entry in `spec.allowed_issuers` exactly matches the `iss` claim in tokens from this provider (copy directly from the provider's OIDC discovery document)
- [ ] `spec.expected_audience` exactly matches the `aud` claim in tokens (copy directly from the provider's configuration)
- [ ] `spec.userinfo_endpoint` is an HTTPS URL pointing to the OIDC UserInfo endpoint
- [ ] `spec.userinfo_endpoint` accepts a Bearer token and returns standard OIDC profile claims

### Authorization

- [ ] The calling identity has `can_create_idp` on the owning organization

## Common Pitfalls

### Mismatched `allowed_issuers`

The `iss` claim in the token must **exactly** match one of the values in `allowed_issuers`. A trailing slash mismatch will cause all token exchanges to fail.

```yaml
# Wrong — missing trailing slash; Auth0 always includes one
allowed_issuers:
  - "https://my-tenant.us.auth0.com"

# Correct — matches the exact iss claim from Auth0
allowed_issuers:
  - "https://my-tenant.us.auth0.com/"
```

To find the exact value, check the token's `iss` claim or the Auth0 tenant's OpenID Connect discovery document at `https://{tenant}/.well-known/openid-configuration`.

### Mismatched `expected_audience`

The `aud` claim must exactly match `expected_audience`. This value is the API identifier configured in Auth0, not the Auth0 tenant URL.

```yaml
# Wrong — using the tenant URL as audience
expected_audience: "https://my-tenant.us.auth0.com/"

# Correct — using the API identifier
expected_audience: "https://api.myplatform.com/"
```

### Using an HTTP (Non-HTTPS) Endpoint

All endpoints (`jwks_uri`, `userinfo_endpoint`) must use HTTPS. Stigmer rejects plain HTTP endpoints.

```yaml
# Wrong
jwks_uri: "http://auth.example.com/.well-known/jwks.json"

# Correct
jwks_uri: "https://auth.example.com/.well-known/jwks.json"
```

### Registering a Non-Public JWKS Endpoint

The `jwks_uri` must be reachable from Stigmer's servers. Private network URLs (e.g., `https://internal.example.com/jwks`) will cause all token exchange attempts to fail with a key-fetch error.

### Using the Wrong Endpoint for `userinfo_endpoint`

The UserInfo endpoint must comply with OpenID Connect Core 1.0 §5.3 — it must accept a Bearer token and return a JSON object with at least the `sub` claim. Passing a generic user API endpoint that requires a different auth scheme will fail.

For Auth0, the UserInfo endpoint is always `https://{tenant}.auth0.com/userinfo`.

### Deleting a Provider With Active Federated Accounts

Deleting an IdentityProvider that still has platform-managed organizations referencing it is blocked. Reassign or remove those references before deletion.

If you delete an IdentityProvider while federated accounts exist for it, those accounts remain in the system but can no longer authenticate via token exchange (since the provider configuration is gone).

### Setting `rate_limit_budget` Too Low

The rate limit budget is shared across all organizations using the provider. If multiple high-traffic integrations share the same IdentityProvider, a low budget can cause token exchange failures under load. Set to `0` for no limit unless throttling is intentional.
