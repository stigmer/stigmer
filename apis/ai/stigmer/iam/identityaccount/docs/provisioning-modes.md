# Provisioning Modes

How IdentityAccounts are created and what distinguishes each mode.

## Overview

Every IdentityAccount is created in one of three provisioning modes. The mode is determined automatically at creation time based on the `idp_id` value and the provisioning context. Users cannot set `provisioning_mode` directly.

| Mode | `provisioning_mode` value | Who creates it | `idp_id` format |
|---|---|---|---|
| Direct | `direct` | Auth0 authentication (JIT on first login) | `auth0\|{subject}` |
| Federated | `federated` | Explicit creation by the platform via API | Raw OIDC sub (e.g., `google-oauth2\|109876543210`) |
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

A federated account is explicitly created by the platform when a new user signs up on the platform. The platform calls the `createFederatedAccount` RPC with the user's external subject, email, and name. Stigmer does **not** auto-provision accounts during authentication.

### Flow

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
   c. If found: proceeds with FGA authorization checks
   d. If NOT found: returns 401 Unauthorized
```

### Characteristics

- `provisioning_mode`: `federated`
- `idp_id`: raw OIDC sub claim from the external provider (e.g., `google-oauth2|109876543210`)
- `identity_provider_ref`: points to the owning IdentityProvider resource
- Uniqueness: the pair `(identity_provider_ref, idp_id)` is unique
- `email`, `first_name`, `last_name`, `picture_url`: provided by the platform at account creation
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
