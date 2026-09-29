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

The CLI creates keys from flags; the YAML shapes above are the body of the `ApiKeyCommandController.create` RPC.

```bash
# Create a key that expires in 90 days (the default when no expiry flag is given)
stigmer apikey create --name ci-pipeline --expires-in 90d

# Or one that never expires
stigmer apikey create --name ci-pipeline --never-expires

# The raw key (stk_...) is printed once — save it immediately.
# With --output yaml, it is spec.key_hash in the response:
#   spec:
#     key_hash: "stk_AbCd...xyz789"  <- raw key (one-time only)
#     fingerprint: "xyz789"
```

## CLI: List the Keys You May View

```bash
stigmer list api-key
```

## CLI: Rotate a Key

Rotation is a delete-then-create operation. There is no in-place key rotation.

```bash
# 1. Create a replacement key
stigmer apikey create --name ci-pipeline-2 --expires-in 90d

# 2. Update all consumers of the old key with the new raw key from step 1.

# 3. Delete the old key
stigmer delete api-key key_01j9zexample
```

## Update Key Expiry

The CLI has no update command. Send the updated resource to the `ApiKeyCommandController.update` RPC (`POST /ai.stigmer.iam.apikey.v1.ApiKeyCommandController/update`); the expiry fields are the only part of the spec it changes, and the key material is always preserved.

Updated YAML:

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: contractor-access
  id: key_01j9zexample
spec:
  expires_at: "2026-09-30T23:59:59Z"
  never_expires: false
```
