# ApiKey Examples

Complete examples for creating and managing API keys. All examples use valid field values.

## Key That Never Expires

Use this for long-lived integrations where you manage rotation manually.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: ci-pipeline
spec:
  never_expires: true
```

## Key With Absolute Expiry

Use this for time-bounded integrations or short-lived credentials.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: contractor-access
spec:
  expires_at: "2026-06-30T23:59:59Z"
  never_expires: false
```

## Key for a Specific Organization

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: staging-deploy-key
  org: acme-corp
spec:
  expires_at: "2026-12-31T00:00:00Z"
  never_expires: false
```

## CLI: Create a Key and Save It

```bash
# Apply the YAML to create the key
stigmer api-key create api-key.yaml

# The raw key is printed in the response — save it immediately.
# Example response excerpt:
#   spec:
#     key_hash: "sk_live_abc123...xyz789"  ← raw key (one-time only)
#     fingerprint: "xyz789"
```

## CLI: List All Keys for the Authenticated User

```bash
stigmer api-key list
```

Sample output:

```
ID              NAME              FINGERPRINT  EXPIRES             LAST USED
ak-01ABC123     ci-pipeline       ab12cd        never              2026-03-01
ak-01DEF456     contractor-access ef34gh        2026-06-30         never
```

## CLI: Rotate a Key

Rotation is a delete-then-create operation. There is no in-place key rotation.

```bash
# 1. Delete the old key
stigmer api-key delete ak-01ABC123

# 2. Create a replacement key
stigmer api-key create replacement-key.yaml

# 3. Update all consumers of the old key with the new raw key from step 2.
```

## CLI: Update Key Expiry

```bash
# Edit the YAML to update expires_at, then apply
stigmer api-key update updated-key.yaml
```

Updated YAML:

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: contractor-access
  id: ak-01DEF456
spec:
  expires_at: "2026-09-30T23:59:59Z"
  never_expires: false
```
