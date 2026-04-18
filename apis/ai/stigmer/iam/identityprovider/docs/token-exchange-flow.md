# Token Exchange Flow

How Stigmer validates external platform tokens and resolves federated identity accounts.

## Overview

The token exchange flow is the mechanism by which an external platform's authenticated users gain access to Stigmer's API without creating separate Stigmer credentials. The flow validates a platform-issued OIDC access token and resolves the user's pre-created federated identity account.

```
Step 1: Platform creates a federated account (one-time, before auth)
  └─► Platform backend calls createFederatedAccount with the user's
      external sub, email, name, and IdentityProvider reference.
      Stigmer returns the identity_account_id for role grants.

Step 2: Platform authenticates user
  └─► User logs in to the external platform (e.g., Planton)

Step 3: User calls Stigmer API with a platform-issued JWT
  └─► Authorization: Bearer {platform_access_token}

Step 4: Stigmer validates the token
  ├─► Peek the JWT iss claim (without full validation)
  ├─► Look up an IdentityProvider whose allowed_issuers contains this issuer
  ├─► Fetch current signing keys from spec.jwks_uri
  ├─► Verify JWT signature using the fetched keys
  ├─► Validate JWT claims:
  │     iss must be in spec.allowed_issuers
  │     aud must equal spec.expected_audience
  └─► Token is valid — extract sub claim and proceed

Step 5: Stigmer resolves the federated account
  ├─► Look up IdentityAccount by (identity_provider_ref, idp_id)
  │   where idp_id is the raw sub claim from the JWT
  ├─► If found: proceed with FGA authorization checks
  └─► If NOT found: return 401 Unauthorized
        ("The platform must create the account before authentication")

Step 6: Stigmer processes the API request
  └─► The resolved identity account is used for FGA authorization
      checks on the requested resource
```

## OIDC Standards

The IdentityProvider spec references standard OpenID Connect Discovery 1.0 fields:

| Spec field | OIDC standard reference |
|---|---|
| `jwks_uri` | OpenID Connect Discovery 1.0 §3 — `jwks_uri` metadata field; RFC 7517 (JSON Web Key Set) |
| `allowed_issuers` | JWT `iss` claim — RFC 7519 §4.1.1 |
| `expected_audience` | JWT `aud` claim — RFC 7519 §4.1.3 |
| `userinfo_endpoint` | OpenID Connect Discovery 1.0 §3 — `userinfo_endpoint` metadata field; OpenID Connect Core 1.0 §5.3 |

For Auth0-based integrators, these values come directly from the Auth0 tenant's OpenID Connect Discovery document at `https://{tenant}.auth0.com/.well-known/openid-configuration`.

## JWKS Key Caching

Stigmer fetches signing keys from `jwks_uri` and caches them. During key rotation:

1. The platform adds the new key to its JWKS endpoint before rotating.
2. Tokens signed with the new key arrive at Stigmer.
3. If Stigmer's cache does not include the new key, it re-fetches the JWKS endpoint.
4. The new key is now cached and validation succeeds.

Because Stigmer supports key re-fetching on cache miss, key rotation does not require changes to the IdentityProvider spec. Keys are identified by their `kid` (Key ID) claim in the JWT header.

## Rate Limiting

The `rate_limit_budget` field sets a shared requests-per-minute limit across all organizations managed through this IdentityProvider. This prevents a single high-traffic integration from monopolizing Stigmer's token exchange capacity.

- Set to `0` (default) for no limit.
- Set to a positive integer (e.g., `1000`) to cap token exchange requests at that rate.

The budget is shared — if multiple organizations use the same IdentityProvider, their combined token exchange traffic counts toward the single budget.

## Multi-Environment Integrations

To support staging and production environments from the same platform, use `allowed_issuers` with multiple values:

```yaml
spec:
  allowed_issuers:
    - "https://platform-prod.us.auth0.com/"
    - "https://platform-staging.us.auth0.com/"
```

This allows tokens from either environment to authenticate via the same IdentityProvider registration.

## Security Considerations

| Concern | Mitigation |
|---|---|
| Token replay across services | `expected_audience` ensures tokens intended for another service are rejected |
| Forged tokens | JWT signature validation against keys from `jwks_uri` prevents forgery |
| Expired tokens | Standard JWT `exp` claim validation is enforced |
| Issuer substitution | `allowed_issuers` whitelist prevents tokens from unexpected issuers |
| Secret exposure | No client secrets are stored in the IdentityProvider spec — only public keys (via JWKS URI) |
| Profile staleness | The platform provides profile data at account creation; updates can be pushed via the update RPC |

## Related Documentation

- [README.md](README.md) — Overview and flow diagram
- [identityprovider-resource-guide.md](identityprovider-resource-guide.md) — YAML schema reference
- [examples.md](examples.md) — Complete YAML examples
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated IdentityAccount provisioning
