# ApiKey YAML Schema Reference

Core schema reference for the `iam.stigmer.ai/v1` ApiKey resource. For overview and concepts, see [README.md](README.md).

## ApiKey YAML Structure

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: my-api-key
spec:
  expires_at: "2027-01-01T00:00:00Z"  # omit when never_expires is true
  never_expires: false
status: {}  # System-managed, never set by users
```

## Top-Level Fields

| Field | Required | Value |
|---|---|---|
| `apiVersion` | Yes | Must be exactly `iam.stigmer.ai/v1` |
| `kind` | Yes | Must be exactly `ApiKey` |
| `metadata` | Yes | Standard API resource metadata (see below) |
| `spec` | Yes | ApiKey configuration (see below) |
| `status` | No | System-managed; never set by users |

## Metadata Fields

| Field | Required | Description |
|---|---|---|
| `metadata.name` | Yes | Human-readable name for the key (e.g., `ci-pipeline`, `local-dev`). |
| `metadata.id` | No | System-generated unique identifier (prefix `ak-`). Never set by users. |
| `metadata.org` | No | Organization that owns this key. Inferred from the authenticated user's organization if omitted. |

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.expires_at` | Conditional | Absolute UTC timestamp at which this key expires. Ignored when `never_expires` is `true`. |
| `spec.never_expires` | No | When `true`, the key never expires and `expires_at` is ignored. Defaults to `false`. |
| `spec.key_hash` | Never | Computed. The SHA-256/Bcrypt hash of the raw key. Never set by users. |
| `spec.fingerprint` | Never | Computed. Last 6 characters of the raw key, used for UI identification. Never set by users. |

### Expiry Rules

An API key must satisfy exactly one of the following:

- `never_expires: true` — key never expires; `expires_at` is ignored even if set.
- `expires_at` is set to a future timestamp — key expires at that moment.

Setting neither results in a key that has no expiry by default (treated as `never_expires: true`).

## Status Fields

Status is system-managed and must never be set by users.

| Field | Description |
|---|---|
| `status.last_used_at` | Timestamp of the most recent successful authentication using this key. `null` if the key has never been used. |
| `status.audit` | Standard audit information: `created_by`, `created_at`, `updated_by`, `updated_at`. |

## Raw Key Handling

When you call `create`, the response includes the **plaintext raw key** in the `spec.key_hash` field (temporarily populated for the response only). This is the only time the raw key is accessible. Store it immediately — it cannot be retrieved again.

After creation, `spec.key_hash` in subsequent `get` responses contains the hash, not the raw key.

## CLI Commands

```bash
# Create a new API key (prints the raw key once — save it immediately)
stigmer api-key create api-key.yaml

# List all API keys for the authenticated user
stigmer api-key list

# Get API key details by ID
stigmer api-key get ak-01ABC123

# Get API key details as YAML
stigmer api-key get ak-01ABC123 --output yaml

# Update an existing API key (e.g., change expiry)
stigmer api-key update api-key.yaml

# Delete an API key
stigmer api-key delete ak-01ABC123
```

## API Operations

| Operation | RPC | Authorization |
|---|---|---|
| Create key | `ApiKeyCommandController.create` | Any authenticated user — no FGA check required |
| Update key | `ApiKeyCommandController.update` | `can_edit` on the ApiKey resource |
| Delete key | `ApiKeyCommandController.delete` | `can_delete` on the ApiKey resource |
| Get key by ID | `ApiKeyQueryController.get` | `can_view` on the ApiKey resource |
| Get key by hash | `ApiKeyQueryController.getByKeyHash` | Authorization checked in handler after load |
| List all keys | `ApiKeyQueryController.findAll` | Returns only keys owned by the authenticated user — no FGA check |

## Related Documentation

- [README.md](README.md) — Overview and key concepts
- [examples.md](examples.md) — Complete YAML and CLI examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
