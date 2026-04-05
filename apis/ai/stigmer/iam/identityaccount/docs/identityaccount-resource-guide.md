# IdentityAccount YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` IdentityAccount resource. For provisioning concepts and flows, see [provisioning-modes.md](provisioning-modes.md).

## IdentityAccount YAML Structure

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQUSER123
  name: Alice Smith
spec:
  idp_id: "auth0|abc123def456"
  email: "alice@example.com"
  first_name: Alice
  last_name: Smith
  picture_url: "https://cdn.example.com/alice.jpg"
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `iam.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `IdentityAccount` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Identity account configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable display name. Typically the account holder's full name. |
| `metadata.id` | No | System-generated unique identifier (prefix `ia-`). Never set by users. |

## Spec Fields

| Field | Required | Mutable | Description |
|---|---|---|---|
| `spec.idp_id` | Yes | No | The external identity provider's subject ID. Globally unique. See [provisioning-modes.md](provisioning-modes.md) for format details per mode. |
| `spec.email` | No | Yes | Email address. For direct accounts: from the Auth0 sign-up. For federated accounts: provided by the platform when creating the account. Ignored on create — assigned by the backend. |
| `spec.first_name` | No | Yes | First name, used in UI and audit logs. |
| `spec.last_name` | No | Yes | Last name, used in UI and audit logs. |
| `spec.picture_url` | No | Yes | URL to the account holder's profile picture. |
| `spec.is_machine_account` | Never | Never | Computed. `true` when `idp_id` ends with `@clients`. Assigned by the backend. |
| `spec.provisioning_mode` | Never | Never | Computed. One of `direct`, `federated`, or `machine`. Assigned by the backend based on `idp_id`. |
| `spec.identity_provider_ref` | Never | Never | Computed. Set only for `federated` accounts — identifies the IdentityProvider that owns this account. Together with `idp_id`, forms the unique federated identity. |

## Status Fields

Status is system-managed and must never be set by users.

| Field | Description |
|---|---|
| `status.audit` | Standard audit information: `created_by`, `created_at`, `updated_by`, `updated_at`. |

## API Operations

### Query Operations

| Operation | RPC | Authorization |
|---|---|---|
| Get by ID | `IdentityAccountQueryController.get` | `can_view` on the IdentityAccount |
| Get current user | `IdentityAccountQueryController.whoAmI` | Any authenticated user — no FGA check |
| Get by email | `IdentityAccountQueryController.getByEmail` | `can_view` on the IdentityAccount |
| Get by IDP ID | `IdentityAccountQueryController.getByIdpId` | `can_view` on the IdentityAccount |
| Get actor info | `IdentityAccountQueryController.getActorInfo` | `can_view` on the IdentityAccount. Internal use — returns lightweight audit actor data to break recursive audit resolution. |

### Command Operations

| Operation | RPC | Authorization | Notes |
|---|---|---|---|
| Create | `IdentityAccountCommandController.create` | None — system-level, called by webhook and federated account creation flows | Not for direct user invocation |
| Update | `IdentityAccountCommandController.update` | `can_edit` on the IdentityAccount | Updates mutable profile fields |
| Delete | `IdentityAccountCommandController.delete` | `can_delete` on the IdentityAccount | |
| Simulate signup webhook | `IdentityAccountCommandController.simulateSignupWebhook` | None | Looks up an email in Auth0 and triggers account creation for users who signed up in Auth0 but not yet in Stigmer |

## CLI Commands

```bash
# Get the current authenticated user's identity account
stigmer identity-account whoami

# Get an identity account by ID
stigmer identity-account get ia-01HQUSER123

# Get an identity account as YAML
stigmer identity-account get ia-01HQUSER123 --output yaml

# Update an identity account's profile fields
stigmer identity-account update identity-account.yaml

# Delete an identity account
stigmer identity-account delete ia-01HQUSER123
```

## Related Documentation

- [README.md](README.md) — Overview and key concepts
- [provisioning-modes.md](provisioning-modes.md) — Direct, federated, and machine provisioning flows
- [examples.md](examples.md) — Complete examples
- [validation-checklist.md](validation-checklist.md) — Pre-update checklist and common pitfalls
