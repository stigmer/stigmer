# Token Exchange Flow

How Stigmer validates external platform tokens and provisions federated identity accounts.

## Overview

The token exchange flow is the mechanism by which an external platform's authenticated users gain access to Stigmer's API without creating separate Stigmer credentials. The flow converts a platform-issued OIDC access token into a Stigmer-native token.

```
Step 1: Platform authenticates user
  └─► User logs in to the external platform (e.g., Planton Cloud)

Step 2: Platform calls Stigmer's token exchange endpoint
  └─► POST to Stigmer's token exchange endpoint
      Authorization: Bearer {platform_access_token}
      Header or body: identity_provider reference (org + slug)

Step 3: Stigmer validates the token
  ├─► Fetch current signing keys from spec.jwks_uri
  ├─► Verify JWT signature using the fetched keys
  ├─► Validate JWT claims:
  │     iss must be in spec.allowed_issuers
  │     aud must equal spec.expected_audience
  └─► Token is valid — extract subject and proceed

Step 4: Stigmer fetches user profile
  └─► GET spec.userinfo_endpoint
      Authorization: Bearer {platform_access_token}
      Response: { sub, email, name, given_name, family_name, picture }

Step 5: Stigmer JIT-provisions the federated account
  ├─► Compute idp_id = "federated:{provider_id}:{external_sub}"
  ├─► If no IdentityAccount with this idp_id exists:
  │     └─► Create IdentityAccount (direct system call, no FGA check yet)
  │         Write self-ownership FGA tuple
  └─► If IdentityAccount already exists:
        └─► Update email, name, picture_url from UserInfo (profile refresh)

Step 6: Stigmer issues a native token
  └─► Return a Stigmer-native JWT to the calling platform
      The platform uses this token for all subsequent Stigmer API calls
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
| Profile staleness | UserInfo is fetched on every token exchange, keeping profile data current |

## Related Documentation

- [README.md](README.md) — Overview and flow diagram
- [identityprovider-resource-guide.md](identityprovider-resource-guide.md) — YAML schema reference
- [examples.md](examples.md) — Complete YAML examples
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated IdentityAccount provisioning
