# Sign-In Flow

How Stigmer verifies a token an external platform issued, and resolves or creates the federated identity account it names.

## Overview

An external platform's users call Stigmer's API with the platform's own JWT. There is no exchange step and no Stigmer-issued token: Stigmer verifies the platform's token on every request, then runs the request as the user's federated identity account.

```
Step 1 (manual mode only): Platform creates a federated account
  └─► Platform backend calls createFederatedAccount with the user's
      external sub, email, name, and IdentityProvider reference.
      Stigmer returns the identity_account_id for role grants.
      With auto_provision_accounts or is_sso_provider, skip this step:
      Stigmer creates the account on the first sign-in (Step 5).

Step 2: Platform authenticates user
  └─► User logs in to the external platform (e.g., Planton)

Step 3: User calls Stigmer API with a platform-issued JWT
  └─► Authorization: Bearer {platform_access_token}

Step 4: Stigmer verifies the token
  ├─► Route the token: find the one IdentityProvider whose allowed_issuers
  │     contains the token's iss AND whose expected_audience the token's aud
  │     carries. A token no provider's route matches is not this lane's;
  │     a token two providers' routes match is refused.
  ├─► Fetch the signing key named by the token's kid from spec.jwks_uri
  ├─► Verify the RS256 signature with that key
  ├─► Check exp (required), nbf (when present) and sub (required)
  └─► Token is valid — extract the sub claim and proceed

Step 5: Stigmer resolves the federated account
  ├─► Look up the IdentityAccount by (this IdentityProvider, sub)
  ├─► If found: proceed
  └─► If NOT found:
        - SSO provider: create the account and grant viewer on the
          owning organization
        - JIT (auto_provision_accounts): create the account; with
          auto_grant_on_org, grant auto_grant_role on the owning
          organization, or on the tenant organization tenant_org_claim
          resolves to
        - Manual mode: refuse with Unauthenticated (the platform must
          create the account first)
      A new account's profile comes from the token: the email from
      email; the first and last name from given_name and family_name,
      else split from name, else the email's local part; the picture
      from picture. Only when the token carries no email does Stigmer
      read userinfo_endpoint. If a grant fails, the new account is
      removed, so an account never exists without the access it was
      created for.

Step 6: Stigmer processes the API request
  └─► The resolved identity account is used for the authorization
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
3. If Stigmer's cache does not include the new key, it re-fetches the JWKS endpoint, at most once per short interval per document, so a flood of tokens naming unknown keys cannot hammer the endpoint.
4. The new key is now cached and validation succeeds.

Because Stigmer supports key re-fetching on cache miss, key rotation does not require changes to the IdentityProvider spec. Keys are identified by their `kid` (Key ID) claim in the JWT header.

## Multi-Environment Integrations

Each environment's auth tenant is its own issuer with its own key set, so register one IdentityProvider per environment. `allowed_issuers` takes several values only when every issuer's discovery document names the same `jwks_uri` (and the same `userinfo_endpoint` when one is set): the save refuses anything else, so an issuer's tokens are verified only with that issuer's own keys. The staging provider beside a production one:

```yaml validate-as="IdentityProvider"
spec:
  jwks_uri: "https://platform-staging.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://platform-staging.us.auth0.com/"
  expected_audience: "https://api.platform.example/"
```

A user who signs in to both environments has one federated account per provider.

## Security Considerations

| Concern | Mitigation |
|---|---|
| Token replay across services | `expected_audience` ensures tokens intended for another service are rejected |
| Forged tokens | RS256 signature validation against keys from `jwks_uri`, which must be the key set every allowed issuer's discovery document names |
| Expired or early tokens | `exp` is required and enforced; `nbf` is enforced when present |
| Issuer substitution | A token is routed only by an issuer in `allowed_issuers` together with this provider's `expected_audience` |
| Secret exposure | No client secrets are stored in the IdentityProvider spec — only public keys (via JWKS URI) |
| Profile staleness | Stigmer sets the profile when it creates the account and does not refresh it on later sign-ins; the platform pushes changes with `updateFederatedAccount` |

## Related Documentation

- [README.md](README.md) — Overview and flow diagram
- [identityprovider-resource-guide.md](identityprovider-resource-guide.md) — YAML schema reference
- [examples.md](examples.md) — Complete YAML examples
- [../../identityaccount/docs/provisioning-modes.md](../../identityaccount/docs/provisioning-modes.md) — Federated IdentityAccount provisioning
