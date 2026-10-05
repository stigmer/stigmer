# Provisioning Modes

How IdentityAccounts are created and what distinguishes each mode.

## Overview

Every IdentityAccount is created in one of three provisioning modes. The mode is determined automatically at creation time based on the `idp_id` value and the provisioning context. Users cannot set `provisioning_mode` directly.

| Mode | `provisioning_mode` value | Who creates it | `idp_id` format |
|---|---|---|---|
| Direct | `direct` | Auth0 authentication (JIT on first login) | `auth0\|{subject}` |
| Federated | `federated` | The platform via API, or Stigmer on the first sign-in when the IdentityProvider provisions accounts | Raw OIDC sub (e.g., `google-oauth2\|109876543210`) |
| Machine | `machine` | Platform bootstrap / M2M setup | `{client_id}@clients` |
| Legacy | `identity_account_provisioning_mode_unspecified` | Pre-dates the provisioning_mode field | Varies |

## Direct Mode

A direct account is created when a user signs up through Stigmer's own Auth0 tenant.

### Flow

```
1. User signs up at Stigmer via Auth0
2. On first login, the authentication pipeline resolves the Auth0 subject ID
3. If no IdentityAccount exists, the account is provisioned through the standard auth flow
4. A self-ownership FGA tuple is written
5. The user can now authenticate to Stigmer using their Auth0 credentials
```

### Characteristics

- `provisioning_mode`: `direct`
- `idp_id`: Auth0 subject ID (e.g., `auth0|abc123def456`)
- `email`: from the Auth0 profile at signup
- `picture_url`: from the Auth0 profile (Google, GitHub, etc.)
- The account can log in to Stigmer directly

## Federated Mode

A federated account belongs to one IdentityProvider. Who creates it depends on how that provider provisions accounts:

- **Manual** (`create_accounts_on_sign_in` false): the platform creates each account with the `createFederatedAccount` RPC, giving the user's external subject, email, and name, before the user calls Stigmer.
- **Just-in-time** (`create_accounts_on_sign_in`, which every SSO provider sets): Stigmer creates the account on the user's first sign-in, from the token's `email`, `given_name` and `family_name` (or `name`) and `picture` claims, or from the provider's `userinfo_endpoint` when the token carries no email. The profile is not refreshed on later sign-ins; the platform updates it with `updateFederatedAccount`.

Whoever creates the account, the provider's `sign_in_role`, when set, is granted the first time the account signs in to an organization through the provider: the organization its token is bound to (the child organization `external_id_claim` names, or the provider's own). It is granted once per account and organization; a role an admin later removes stays removed. Every token the provider vouches for works in its bound organization only.

The [sign-in flow](../../identityprovider/docs/sign-in-flow.md) shows how each request is verified and its account resolved.

### Manual Flow

```
1. Platform backend creates a federated IdentityAccount via createFederatedAccount:
   a. Provides the IdentityProvider reference (org + slug)
   b. Provides the user's external sub claim (raw OIDC sub)
   c. Provides email, first_name, last_name, picture_url
   d. Stigmer creates the account and returns the identity_account_id
   e. Stigmer writes a self-ownership FGA tuple
2. Platform grants roles to the new account (e.g., member on the organization)
3. When the user authenticates via the platform's JWT:
   a. Stigmer validates the JWT against the IdentityProvider's JWKS
   b. Stigmer resolves the account by (identity_provider_ref, idp_id)
   c. If found: proceeds with FGA authorization checks, in the organization
      the token is bound to
   d. If NOT found: returns 401 Unauthorized (manual mode only; see above)
```

### Characteristics

- `provisioning_mode`: `federated`
- `idp_id`: raw OIDC sub claim from the external provider (e.g., `google-oauth2|109876543210`)
- `identity_provider_ref`: points to the owning IdentityProvider resource
- Uniqueness: the pair `(identity_provider_ref, idp_id)` is unique
- `email`, `first_name`, `last_name`, `picture_url`: provided by the platform at account creation, or read from the first sign-in's token (or userinfo) when Stigmer creates the account
- The account **cannot** log in to Stigmer directly — it has no credentials in Stigmer's Auth0

### `idp_id` for Federated Accounts

The `idp_id` stores the raw OIDC `sub` claim from the external identity provider, exactly as it appears in the JWT. Uniqueness is scoped by the `identity_provider_ref` — two different identity providers can have users with the same `sub` without conflict.

Example: `google-oauth2|109876543210`

## Machine Mode

A machine account represents an Auth0 M2M client credential. It is used for inter-service communication — one service calling another service's API on behalf of itself, not on behalf of a user.

### Flow

```
1. A machine account is registered in Auth0 as an M2M application
2. During platform bootstrap, Stigmer creates a machine IdentityAccount
   with idp_id = "{auth0_client_id}@clients"
3. FGA policies are created granting the machine account the required permissions
4. The service authenticates by presenting a client credentials JWT to Stigmer
```

### Characteristics

- `provisioning_mode`: `machine`
- `idp_id`: ends with `@clients` (e.g., `HqKdZn9xyz@clients`)
- `is_machine_account`: `true` (computed)
- `email`, `first_name`, `last_name`: typically empty — machine accounts have no human profile
- The account authenticates via client credentials, not user login

## Related Documentation

- [README.md](README.md) — Overview and key concepts
- [identityaccount-resource-guide.md](identityaccount-resource-guide.md) — YAML schema and CLI reference
- [examples.md](examples.md) — Complete examples
- [../../identityprovider/docs/README.md](../../identityprovider/docs/README.md) — IdentityProvider resource (required for federated mode)
