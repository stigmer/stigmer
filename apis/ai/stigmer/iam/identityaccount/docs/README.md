# IdentityAccount Resource Documentation

Comprehensive documentation for the `iam.stigmer.ai/v1` IdentityAccount resource.

## What Is an IdentityAccount?

An IdentityAccount represents a user or machine principal in Stigmer's authorization model. Every entity that can be granted permissions — human users, service accounts, and machine clients — has a corresponding IdentityAccount.

All Fine-Grained Authorization (FGA) tuples use `identity_account` as the principal type. When a policy says "Alice can view the Demo organization", Alice's IdentityAccount ID is the principal in that tuple.

## Provisioning Modes

IdentityAccounts are created in one of four ways:

| Mode | Description | `idp_id` format |
|---|---|---|
| `direct` | User signed up via Stigmer's Auth0 tenant | Auth0 subject ID (e.g., `auth0\|abc123`) |
| `federated` | Created by the platform, or by Stigmer on the first sign-in, for federated authentication via an [FederationIssuer](../../federationissuer/docs/README.md) | Raw OIDC sub claim (e.g., `google-oauth2\|109876543210`), scoped by `federation_issuer_ref` |
| `app_user` | A person signing in from an organization's own product, whose token `TokenService.mintUserToken` mints with a service account's key | `stgm_pc\|{org}\|{external_user_id}` |
| `service_account` | An organization's own non-person account, created by an admin with `createServiceAccount` | `stgm_sa\|{org id}\|{random}` |

Federated accounts have no credentials in Stigmer's Auth0 and cannot log in directly to Stigmer. They sign in with their FederationIssuer's own tokens, which Stigmer verifies on each request ([sign-in flow](../../federationissuer/docs/sign-in-flow.md)), and are authorized as their federated account.

## Key Concepts

| Concept | Detail |
|---|---|
| **IDP ID** | The external identity provider's subject identifier. Globally unique within Stigmer. |
| **Fingerprint** | Email address — the primary human-readable identifier for direct and federated accounts. |
| **Self-ownership** | On creation, the handler writes a self-ownership FGA tuple. Each IdentityAccount is its own resource. |
| **Machine accounts** | A `direct` account whose `idp_id` ends with `@clients` (an Auth0 client credential). `is_machine_account` is `true` (computed). |
| **System-created** | The `create` RPC is system-level — called by the Auth0 webhook and federated account creation flows, not directly by users. |

## Documentation Index

| Document | Description |
|---|---|
| [identityaccount-resource-guide.md](identityaccount-resource-guide.md) | YAML schema reference — spec fields, status, query operations, CLI commands |
| [provisioning-modes.md](provisioning-modes.md) | Detailed walkthrough of each provisioning mode, and of machine accounts |
| [examples.md](examples.md) | Complete examples and CLI usage for lookups and updates |
| [validation-checklist.md](validation-checklist.md) | Pre-update checklist and common pitfalls |
