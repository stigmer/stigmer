# API Key Authentication

API keys provide programmatic access to Stigmer without requiring interactive OAuth2 flows. They're ideal for:
- CI/CD pipelines
- Automated scripts
- Server-to-server integrations
- CLI tools

## Key Characteristics

**Security Model:**
- API keys use the prefix `stk_` (stigmer-key)
- Generated with 32 bytes (256 bits) of cryptographic randomness
- Stored as SHA-256 hashes (never the raw key)
- Only the last 6 characters shown as fingerprint in UI

**Lifecycle:**
- Raw key returned ONLY on creation - cannot be retrieved later
- Keys can expire or be set to never expire
- Keys can be revoked immediately via delete
- Last used timestamp tracked automatically

**Authentication:**
- Used in `Authorization: Bearer stk_...` header (same as JWT)
- Validated via Redis cache + IAM service lookup
- Resolved to identity account via owner metadata

## API Endpoints

### Create API Key

```yaml
# POST /api/v1/iam/apikey/create
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: ci-cd-key
  description: Key for GitHub Actions
spec:
  expiresAt: "2026-12-31T23:59:59Z"
  # OR neverExpires: true
```

**Response:** Full ApiKey with `spec.keyHash` containing the raw key **ONCE**

### List API Keys

```yaml
# POST /api/v1/iam/apikey/findAll
{}  # Uses identity from auth header
```

**Response:** List of API keys (without raw keys, only fingerprints)

### Get API Key

```yaml
# POST /api/v1/iam/apikey/get
value: "api-key-id"
```

### Update API Key

```yaml
# POST /api/v1/iam/apikey/update
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  id: "api-key-id"
  name: renamed-key
spec:
  expiresAt: "2027-12-31T23:59:59Z"
```

### Delete (Revoke) API Key

```yaml
# POST /api/v1/iam/apikey/delete
value: "api-key-id"
```

## Backend Implementation

### Authentication Flow

1. **Token Extraction**
   - `GrpcSecurityConfigBase` intercepts all gRPC requests
   - `AuthTokenExtractor` pulls token from `Authorization` header

2. **API Key Detection**
   - `RedisApiKeyIntrospector` checks for `stk_` prefix
   - If match, proceeds with API key validation

3. **Validation**
   - Hash token with SHA-256
   - Lookup in Redis cache (`ApiKeyRedisCacheRepo`)
   - On cache miss, call IAM service (`ApiKeyGrpcRepo`)
   - Cache result for 1 hour

4. **Expiration Check**
   - Compare current time vs `spec.expiresAt`
   - Reject if expired

5. **Identity Resolution**
   - Extract owner ID from `metadata.ownerId`
   - Resolve to IDP ID via `IdentityAccountIdToIdpIdCacheProxy`
   - Build OAuth2 principal with `sub` claim

6. **Security Context**
   - Set Spring Security authentication
   - Downstream code sees same principal as JWT auth

### Key Components

**Java Classes:**
- `ApiKeyConstants` - Defines `stk_` prefix
- `ApiKeyHasher` - SHA-256 hashing utility
- `ApiKeyFingerprintExtractor` - Last 6 chars extraction
- `RedisApiKeyIntrospector` - Main validation logic
- `ApiKeyHashToApiKeyCacheProxy` - Cache-aside pattern
- `GrpcSecurityConfigBase` - Wires up both JWT + API key auth

**Proto Definitions:**
- `api.proto` - ApiKey message, ApiKeyStatus
- `spec.proto` - ApiKeySpec with hash, fingerprint, expiration
- `command.proto` - Create, update, delete RPCs
- `query.proto` - Get, getByKeyHash, findAll RPCs
- `io.proto` - Wrapper messages (ApiKeys, ApiKeyId, ApiKeyHash)

## Usage Examples

### Create and Use in CLI

```bash
# Create key
stigmer iam apikey create \
  --name ci-key \
  --expires-at 2026-12-31T23:59:59Z

# Response includes raw key (save it!)
# stk_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGhIjKl

# Use in subsequent commands
export STIGMER_API_KEY="stk_..."
stigmer workflow list  # Uses API key from env var
```

### Use in CI/CD

```yaml
# GitHub Actions example
- name: Deploy with Stigmer
  env:
    STIGMER_API_KEY: ${{ secrets.STIGMER_API_KEY }}
  run: |
    stigmer deploy --environment production
```

### Use in Code

```java
// Java client example
var channel = ManagedChannelBuilder
    .forAddress("api.stigmer.ai", 443)
    .useTransportSecurity()
    .build();

var metadata = new Metadata();
metadata.put(
    Metadata.Key.of("Authorization", Metadata.ASCII_STRING_MARSHALLER),
    "Bearer stk_..."
);

var stub = ApiKeyCommandControllerGrpc.newBlockingStub(channel)
    .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));
```

## Security Considerations

**Storage:**
- ✅ Store raw keys in secure secret managers (AWS Secrets Manager, HashiCorp Vault)
- ❌ Never commit keys to git repositories
- ❌ Never log raw keys

**Rotation:**
- Create new key before old expires
- Update consumers with new key
- Delete old key after cutover

**Scope:**
- API keys inherit full permissions of owner identity
- No per-key scoping (yet) - create separate identity accounts if needed
- Consider machine accounts for service-specific keys

**Monitoring:**
- Track `status.lastUsedAt` to detect unused keys
- Delete keys not used in 90+ days
- Alert on keys used from unexpected IPs (future enhancement)

## Differences from JWT

| Aspect | JWT | API Key |
|--------|-----|---------|
| Format | Base64-encoded JSON with signature | Random bytes with prefix |
| Expiration | Built into token | Stored in database |
| Revocation | Not possible (wait for expiry) | Immediate (delete from DB) |
| User Context | Includes user claims | Looked up from owner |
| Use Case | Interactive users | Automation/services |

## Future Enhancements

- [ ] Per-key scoping (restrict to specific resources/actions)
- [ ] IP allowlisting per key
- [ ] Rate limiting per key
- [ ] Key usage analytics (request count, bytes transferred)
- [ ] Temporary keys (auto-delete after N days)
- [ ] Key rotation helpers (create replacement, notify owner)
