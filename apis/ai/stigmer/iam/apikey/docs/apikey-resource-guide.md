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
| `metadata.id` | No | System-generated unique identifier: `key_` followed by a lowercase ULID. Never set by users. |
| `metadata.org` | No | Organization that owns this key. Inferred from the authenticated user's organization if omitted. |

## Spec Fields

| Field | Required | Description |
|---|---|---|
| `spec.expires_at` | Conditional | Absolute UTC timestamp at which this key expires. Ignored when `never_expires` is `true`. |
| `spec.never_expires` | No | When `true`, the key never expires and `expires_at` is ignored. Defaults to `false`. |
| `spec.key_hash` | Never | Computed. The SHA-256 hash of the raw key, Base64URL without padding (the create response carries the raw key here instead; see Raw Key Handling). Never set by users. |
| `spec.fingerprint` | Never | Computed. Last 6 characters of the raw key, used for UI identification. Never set by users. |

### Expiry Rules

Set one of the two, never both:

- `never_expires: true`, with `expires_at` left unset — the key never expires.
- `expires_at` set to a future timestamp — the key expires at that moment.

Setting neither also gives a key with no expiry. `stigmer apikey create` always sets one: 90 days from now, unless `--expires-in` or `--never-expires` says otherwise.

Do not set both. The contract says `never_expires` wins, but the server currently expires such a key at `expires_at` ([#1434](https://github.com/stigmer/stigmer/issues/1434)).

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
stigmer apikey create --name ci-pipeline --expires-in 90d

# List the API keys you may view
stigmer list api-key

# Get API key details by ID
stigmer get api-key key_01j9zexample

# Get API key details as YAML
stigmer get api-key key_01j9zexample --output yaml

# Find which key a raw token belongs to
stigmer apikey fingerprint stk_...

# Delete an API key
stigmer delete api-key key_01j9zexample
```

The CLI creates keys from flags, not from a YAML file, and has no update command. Change a key's expiry through the `ApiKeyCommandController.update` RPC with the YAML shape above (see [examples.md](examples.md)). Every flag is in the CLI reference: [`stigmer apikey`](../../../../../../docs/cli/commands/apikey.mdx).

## API Operations

| Operation | RPC | Authorization |
|---|---|---|
| Create key | `ApiKeyCommandController.create` | Any authenticated user — no FGA check required |
| Update key | `ApiKeyCommandController.update` | `can_edit` on the ApiKey resource |
| Delete key | `ApiKeyCommandController.delete` | `can_delete` on the ApiKey resource |
| Get key by ID | `ApiKeyQueryController.get` | `can_view` on the ApiKey resource |
| Get key by hash | `ApiKeyQueryController.getByKeyHash` | Internal lookup with no permission check; the caller must already hold the key's hash ([#1435](https://github.com/stigmer/stigmer/issues/1435)) |
| List all keys | `ApiKeyQueryController.findAll` | Returns the keys the caller may view (`can_view`); on a trusted-local server, every key |

## Related Documentation

- [README.md](README.md) — Overview and key concepts
- [examples.md](examples.md) — Complete YAML and CLI examples
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
