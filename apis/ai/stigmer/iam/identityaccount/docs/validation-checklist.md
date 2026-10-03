# IdentityAccount Validation Checklist and Common Pitfalls

Pre-update checklist and known pitfalls when working with IdentityAccounts.

## Pre-Update Checklist

### Required Fields

- [ ] `apiVersion` is exactly `iam.stigmer.ai/v1`
- [ ] `kind` is exactly `IdentityAccount`
- [ ] `metadata.id` is present when updating (the system-generated `ia-` prefixed ID)
- [ ] `spec.idp_id` is present and unchanged (immutable after creation)

### Mutable Fields Only

- [ ] Only `spec.first_name`, `spec.last_name`, and `spec.picture_url` are modified in the update payload
- [ ] `spec.email` is not set (assigned by the backend; ignored on create)
- [ ] `spec.is_machine_account` is not set (computed from `idp_id`)
- [ ] `spec.provisioning_mode` is not set (computed by the backend)
- [ ] `spec.identity_provider_ref` is not set (computed for federated accounts only)

### Never-Set Fields

- [ ] `status` fields are not set (system-managed)

## Common Pitfalls

### Attempting to Update `idp_id`

`idp_id` is the identity anchor — it is immutable after creation. Attempting to change it will fail.

```yaml no-validate="a wrong and a right value side by side"
# Wrong — idp_id cannot be changed
spec:
  idp_id: "auth0|new-subject-id"

# Correct — keep the original idp_id
spec:
  idp_id: "auth0|abc123def456"
```

### Attempting to Call `create` Directly

The `create` RPC is system-level. It is called by federated account creation and bootstrap migrations, not by end users or CLI. Direct invocation without the system machine account context will be rejected.

### Federated Account Must Be Created Before Authentication (Manual Mode)

When the IdentityProvider provisions accounts manually (neither `auto_provision_accounts` nor `is_sso_provider`), the platform must create each federated account with the `createFederatedAccount` RPC before the user authenticates. If a user presents a valid JWT but no account exists for their `(identity_provider_ref, sub)` pair, Stigmer returns 401 Unauthorized. A just-in-time or SSO provider creates the account on the first sign-in instead.

### Confusing IdentityAccount ID with IDP ID

The `metadata.id` (e.g., `ia-01HQUSER123`) is Stigmer's internal ID. The `spec.idp_id` (e.g., `auth0|abc123`) is the external provider's identifier. Use `metadata.id` in IamPolicy principal references, not `idp_id`.

```yaml no-validate="a wrong and a right value side by side"
# Wrong in an IamPolicy — using idp_id as principal ID
spec:
  principal:
    kind: identity_account
    id: "auth0|abc123def456"  # this is the idp_id, not the resource ID

# Correct — use the metadata.id
spec:
  principal:
    kind: identity_account
    id: ia-01HQUSER123
```

### Deleting an Account Does Not Revoke Active Tokens

Deleting an IdentityAccount removes it from Stigmer's database and cleans up IAM policies. However, Auth0 tokens issued before deletion may remain valid until they expire. Invalidate Auth0 sessions separately if immediate revocation is required.

### Deleting a Federated Account Does Not Block a Just-In-Time or SSO Sign-In

A just-in-time or SSO IdentityProvider creates an account for any subject it vouches for that has none. After a federated account is deleted, the user's next sign-in with a valid token creates a new account and grants it any role the provider grants automatically. To keep such a user out of the provider's organizations, revoke the account's access and keep the account (`deprovisionFederatedAccount` with `delete_account: false`): an existing account is never granted a role at sign-in, though it can still sign in. Stopping the user at the platform's own sign-in stops them signing in at all.
