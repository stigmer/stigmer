# Provisioning Modes

How IdentityAccounts are created and what distinguishes each mode.

## Overview

Every IdentityAccount is created in one of three provisioning modes. The mode is determined automatically at creation time based on the `idp_id` value and the provisioning context. Users cannot set `provisioning_mode` directly.

| Mode | `provisioning_mode` value | Who creates it | `idp_id` format |
|---|---|---|---|
| Direct | `direct` | Auth0 signup webhook | `auth0\|{subject}` |
| Federated | `federated` | JIT provisioning via IdentityProvider | `federated:{provider_id}:{external_sub}` |
| Machine | `machine` | Platform bootstrap / M2M setup | `{client_id}@clients` |
| Legacy | `identity_account_provisioning_mode_unspecified` | Pre-dates the provisioning_mode field | Varies |

## Direct Mode

A direct account is created when a user signs up through Stigmer's own Auth0 tenant.

### Flow

```
1. User signs up at Stigmer via Auth0
2. Auth0 fires a signup webhook to Stigmer
3. Stigmer's webhook handler calls IdentityAccountCommandController.create
4. A direct IdentityAccount is created with idp_id = Auth0 subject ID
5. A self-ownership FGA tuple is written
6. The user can now authenticate to Stigmer using their Auth0 credentials
```

### Characteristics

- `provisioning_mode`: `direct`
- `idp_id`: Auth0 subject ID (e.g., `auth0|abc123def456`)
- `email`: from the Auth0 profile at signup
- `picture_url`: from the Auth0 profile (Google, GitHub, etc.)
- The account can log in to Stigmer directly

## Federated Mode

A federated account is created automatically (Just-In-Time) when a user from an external platform authenticates to Stigmer via a configured [IdentityProvider](../../identityprovider/docs/README.md).

### Flow

```
1. External platform (e.g., Planton Cloud) calls Stigmer's token exchange endpoint
   with the user's OIDC access token
2. Stigmer validates the token:
   a. Fetches signing keys from the IdentityProvider's jwks_uri
   b. Verifies the JWT signature
   c. Validates iss (allowed_issuers) and aud (expected_audience)
3. Stigmer fetches the user profile from the IdentityProvider's userinfo_endpoint
4. If no IdentityAccount exists for this user+provider combination:
   a. Creates a federated IdentityAccount with idp_id = "federated:{provider_id}:{external_sub}"
   b. Sets email, first_name, last_name, picture_url from UserInfo
   c. Sets identity_provider_ref to the IdentityProvider resource
   d. Writes a self-ownership FGA tuple
5. If the account already exists, profile fields are updated from UserInfo (kept fresh)
6. Stigmer issues a Stigmer-native token for subsequent API access
```

### Characteristics

- `provisioning_mode`: `federated`
- `idp_id`: compound key (e.g., `federated:idp_01JXY123:auth0|user-456`)
- `email`, `first_name`, `last_name`, `picture_url`: from the IdentityProvider's UserInfo response; refreshed on every token exchange
- `identity_provider_ref`: points to the owning IdentityProvider resource
- The account **cannot** log in to Stigmer directly — it has no credentials in Stigmer's Auth0

### `idp_id` Compound Key

The compound key format ensures global uniqueness across all identity providers:

```
federated:{provider_id}:{external_sub}
           └── IdentityProvider resource ID
                             └── User's subject ID in the external system
```

Example: `federated:idp_01JXY123:auth0|user-456`

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

## Simulate Signup Webhook

The `simulateSignupWebhook` RPC is a recovery tool for users who created an account in Auth0 (e.g., by accepting an invitation link) but whose account was not created in Stigmer due to a missed or failed webhook.

```bash
# Trigger account creation for an email that exists in Auth0 but not in Stigmer
stigmer identity-account simulate-signup-webhook --email alice@example.com
```

The handler:
1. Looks up the email in Auth0
2. If found, fires a synthetic signup webhook payload to Stigmer's webhook endpoint
3. The standard webhook flow creates the IdentityAccount

## Related Documentation

- [README.md](README.md) — Overview and key concepts
- [identityaccount-resource-guide.md](identityaccount-resource-guide.md) — YAML schema and CLI reference
- [examples.md](examples.md) — Complete examples
- [../../identityprovider/docs/README.md](../../identityprovider/docs/README.md) — IdentityProvider resource (required for federated mode)
