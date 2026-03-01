# ApiKey Validation Checklist and Common Pitfalls

Pre-create checklist and known pitfalls when creating API keys.

## Pre-Create Checklist

### Required Fields

- [ ] `apiVersion` is exactly `iam.stigmer.ai/v1`
- [ ] `kind` is exactly `ApiKey`
- [ ] `metadata.name` is present and descriptive (e.g., `ci-pipeline`, not `key1`)

### Expiry Configuration

- [ ] Either `never_expires: true` is set, or `expires_at` is set to a future UTC timestamp
- [ ] `expires_at` is in RFC 3339 format (e.g., `"2027-01-01T00:00:00Z"`)
- [ ] `expires_at` is in the future at the time of creation

### Never-Set Fields

- [ ] `spec.key_hash` is not set (computed by the system on create)
- [ ] `spec.fingerprint` is not set (computed by the system on create)
- [ ] `status` fields are not set (system-managed)
- [ ] `metadata.id` is not set for new keys (system-generated)

### Post-Create

- [ ] The raw key from the create response is stored immediately in a secrets manager or CI/CD variable
- [ ] The raw key is not logged or committed to version control

## Common Pitfalls

### Setting Both `never_expires` and `expires_at`

When `never_expires: true`, the `expires_at` field is silently ignored. Do not set both.

```yaml
# Ambiguous — expires_at is ignored
spec:
  expires_at: "2027-01-01T00:00:00Z"
  never_expires: true

# Clear intent
spec:
  never_expires: true
```

### Attempting to Retrieve the Raw Key After Creation

The raw key is returned only in the create response. Subsequent `get` calls return the hash and fingerprint only.

```bash
# Wrong — this returns the hash, not the raw key
stigmer api-key get ak-01ABC123

# Correct — save the key immediately after create
stigmer api-key create key.yaml  # save `spec.key_hash` from this output
```

### Losing the Raw Key

If you lose the raw key, you must delete the key and create a replacement. There is no key recovery mechanism.

### Setting `expires_at` Without a Timezone

All timestamps must be UTC and include the `Z` suffix or an explicit offset.

```yaml
# Wrong — missing timezone
expires_at: "2027-01-01T00:00:00"

# Correct
expires_at: "2027-01-01T00:00:00Z"
```

### Using a Past `expires_at`

Creating a key with an `expires_at` in the past produces an already-expired key. Always verify the timestamp is in the future before applying.
