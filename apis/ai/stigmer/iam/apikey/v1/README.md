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
- Validated by a direct lookup of the key's hash in the server's store, with no cache, so a deleted key is refused on the very next request
- Resolved to the identity account that created the key
- A key created while the server had sign-in turned off is refused once sign-in is on. Its creator was the local operator, who is not the account anyone signs in as. The refusal is `UNAUTHENTICATED` with the `ErrorInfo` reason `API_KEY_CREATED_BEFORE_SIGN_IN` (domain `stigmer.ai`, no metadata), so a client can tell it apart from a wrong or expired key. The fix is to sign in and create a new key.

## API Endpoints

The server speaks [Connect](https://connectrpc.com/docs/protocol/): each RPC is a `POST` to `/<package>.<Service>/<method>` with a JSON body in the message's JSON form. The bodies below are written as YAML, the shape the [`curl/`](curl/) samples use.

### Create API Key

```yaml
# POST /ai.stigmer.iam.apikey.v1.ApiKeyCommandController/create
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: ci-cd-key
spec:
  expiresAt: "2026-12-31T23:59:59Z"
  # OR neverExpires: true
```

**Response:** Full ApiKey with `spec.keyHash` containing the raw key **ONCE**

### List API Keys

```yaml
# POST /ai.stigmer.iam.apikey.v1.ApiKeyQueryController/findAll
{}  # Uses identity from auth header
```

**Response:** List of API keys (without raw keys, only fingerprints)

### Get API Key

```yaml
# POST /ai.stigmer.iam.apikey.v1.ApiKeyQueryController/get
value: "key_01j9zexample"
```

### Update API Key

```yaml
# POST /ai.stigmer.iam.apikey.v1.ApiKeyCommandController/update
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  id: "key_01j9zexample"
  name: renamed-key
spec:
  expiresAt: "2027-12-31T23:59:59Z"
```

### Delete (Revoke) API Key

```yaml
# POST /ai.stigmer.iam.apikey.v1.ApiKeyCommandController/delete
value: "key_01j9zexample"
```

## Backend Implementation

The server's API-key module is `backend/services/stigmer-server/src/domain/apikey/`. Its file headers are the source of truth for the byte-level rules (prefix, hash encoding, error copy); this section is the map.

### Authentication Flow

1. **Claim**: the identity verifier chain offers each bearer token to the API-key verifier, which claims tokens starting with `stk_` (case-insensitive). Any other token passes to the next verifier.
2. **Hash**: the raw token is hashed with SHA-256 and encoded as Base64URL without padding, the form `spec.key_hash` stores.
3. **Lookup**: the key is read from the store by that hash. There is no cache, so a deleted key is refused on the next request.
4. **Expiry**: a key whose `spec.expires_at` is set and past is refused with `token has expired`; an unknown or deleted key with `invalid token`.
5. **Identity**: the request runs as the key's creator (`status.audit.spec_audit.created_by`), named by the creator's identity account: its email, and its first and last name. When the account has neither name, the name the key recorded when it was minted stands in, then the account's own name, then its email. Downstream code sees the same principal a signed-in session of that account would. A key whose creator stamp is an account id and whose account has been deleted is refused with `invalid token`: deleting an account does not delete its keys, so this is what stops them, for as long as no account answers for that id. A direct account's id is derived from its issuer subject, so the same person signing up again brings the id, and those keys, back (#1771). A key minted before its creator had an account carries their raw issuer subject instead; while no account answers for that subject, it is admitted as that unprovisioned subject, exactly as a sign-in with the same subject would be.
6. **Last use**: the key's `status.last_used_at` is stamped, at most once a minute.

### Key Components

**Server modules** (under `backend/services/stigmer-server/src/domain/apikey/`):
- `keymaterial.ts`: key generation (`stk_` plus 32 random bytes, Base64URL), hashing and the last-six-character fingerprint
- `verifier.ts`: the verifier-chain entry, which runs the flow above (hashing through `keymaterial.ts`, reading through `lookup.ts`)
- `lookup.ts`: the one lookup by hash, shared by the verifier and the `getByKeyHash` RPC
- `controller.ts`: the command and query RPCs

**Proto Definitions:**
- `api.proto` - ApiKey message, ApiKeyStatus
- `spec.proto` - ApiKeySpec with hash, fingerprint, expiration
- `command.proto` - Create, update, delete RPCs
- `query.proto` - Get, getByKeyHash, findAll RPCs
- `io.proto` - Wrapper messages (ApiKeys, ApiKeyId, ApiKeyHash)

## Usage Examples

### Create and Use in CLI

```bash
# Create a key (expires in 90 days unless --expires-in or --never-expires says otherwise)
stigmer apikey create --name ci-key --expires-in 90d

# The raw key is printed once (save it!)
# stk_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfG

# Use it for subsequent commands
export STIGMER_API_KEY="stk_..."
stigmer list agents  # authenticates with the API key
```

Every flag is in the CLI reference: [`stigmer apikey`](../../../../../../docs/cli/commands/apikey.mdx).

### Use in CI/CD

```yaml
# GitHub Actions example
- name: Apply Stigmer resources
  env:
    STIGMER_API_KEY: ${{ secrets.STIGMER_API_KEY }}
  run: |
    stigmer apply -f ./stigmer/
```

### Use in Code

```typescript
import { createNodeClient } from "@stigmer/sdk/node";

const stigmer = createNodeClient({
  baseUrl: "https://api.stigmer.ai",
  apiKey: process.env.STIGMER_API_KEY, // "stk_..."
});

const agent = await stigmer.agent.get("my-agent");
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
