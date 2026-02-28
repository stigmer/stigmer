# IamPolicy YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` IamPolicy resource. For conceptual overview and the OpenFGA model, see [README.md](README.md) and [authorization-model.md](authorization-model.md).

## IamPolicy YAML Structure

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-demo-org-viewer
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQUSER123
  resource:
    kind: organization
    id: org-01HQDEMO456
  relation: viewer
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `iam.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `IamPolicy` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | Policy binding (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name describing the binding (e.g., `alice-demo-org-viewer`). |
| `metadata.id` | No | System-generated unique identifier (prefix `iamp-`). Never set by users. |
| `metadata.org` | Yes | Organization this policy belongs to. Used for scoping and ownership. |

## Spec Fields

### `spec.principal` — Who gets access

An `ApiResourceRef` identifying the entity being granted the permission.

| Field | Required | Description |
|---|---|---|
| `principal.kind` | Yes | Resource kind of the principal. Typical values: `identity_account`, `team`, `organization`. |
| `principal.id` | Yes | ID of the principal resource (e.g., `ia-01HQUSER123`, `tm-01HQTEAM456`). |
| `principal.relation` | No | Qualifies which sub-set of the principal is included. Required when the principal is a `team` — set to `member` or `admin` to specify which team members receive the permission. |

### `spec.resource` — What is being accessed

An `ApiResourceRef` identifying the entity being protected.

| Field | Required | Description |
|---|---|---|
| `resource.kind` | Yes | Resource kind of the protected entity. Examples: `organization`, `environment`, `agent`, `mcp_server`, `cloud_resource`. |
| `resource.id` | Yes | ID of the protected resource. |
| `resource.relation` | No | Rarely used for resources. Leave unset in most cases. |

### `spec.relation` — What permission is granted

A string matching the `role_code` defined in the authorization model for the target resource kind.

| Common value | Meaning |
|---|---|
| `owner` | Full control including deletion and access delegation |
| `admin` | Full control excluding deletion |
| `editor` | Read and write, no access management |
| `viewer` | Read-only access |
| `member` | Basic membership (e.g., org member) |

The available relations depend on the resource kind. Consult the authorization model for the target resource type to see which relations are defined.

## Status Fields

Status is system-managed and must never be set by users.

| Field | Description |
|---|---|
| `status.audit` | Standard audit information: `created_by`, `created_at`, `updated_by`, `updated_at`. |

## API Operations

### Standard Operations (require `can_grant_access` on the resource)

| Operation | RPC | Notes |
|---|---|---|
| Grant access | `IamPolicyCommandController.create` | Input: `IamPolicySpec`. Idempotent — creating an existing policy is a no-op. |
| Revoke access | `IamPolicyCommandController.delete` | Input: `IamPolicySpec`. Idempotent — deleting a nonexistent policy is a no-op. |
| Get policy | `IamPolicyQueryController.get` | Requires `can_view_access` on the policy. |

### Authorization Query Operations

| Operation | RPC | Notes |
|---|---|---|
| Check authorization | `IamPolicyQueryController.checkAuthorization` | Boolean check: does principal X have permission Y on resource Z? No FGA check on the caller. |
| List authorized resources | `IamPolicyQueryController.listAuthorizedResourceIds` | What resource IDs of a given kind can principal X access with relation Y? |
| List authorized principals | `IamPolicyQueryController.listAuthorizedPrincipalIds` | What principal IDs of a given kind have relation Y on resource Z? |

### Operator-Only Operations

These RPCs require `operator` permission on `platform:stigmer`. They are for internal system use only.

| Operation | RPC | Purpose |
|---|---|---|
| Bootstrap policy | `IamPolicyCommandController.bootstrapPolicy` | Creates initial policies during resource creation when no FGA tuples exist yet (chicken-and-egg problem). |
| Create platform link | `IamPolicyCommandController.createPlatformLink` | Links an identity account to the platform. Used during account bootstrapping. |
| Cleanup resource policies | `IamPolicyCommandController.cleanupResourcePolicies` | Removes all policies referencing a deleted resource (bidirectional). |

## CLI Commands

```bash
# Grant access (create a policy)
stigmer iam-policy create policy.yaml

# Revoke access (delete a policy)
stigmer iam-policy delete policy.yaml

# Get a policy by ID
stigmer iam-policy get iamp-01ABC123

# Get a policy as YAML
stigmer iam-policy get iamp-01ABC123 --output yaml

# Check authorization
stigmer iam-policy check-authorization --principal-kind identity_account \
  --principal-id ia-01HQUSER123 \
  --resource-kind organization \
  --resource-id org-01HQDEMO456 \
  --relation viewer
```

## Related Documentation

- [README.md](README.md) — Overview and core concepts
- [authorization-model.md](authorization-model.md) — OpenFGA integration and authorization query semantics
- [examples.md](examples.md) — Complete examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
