# What is an API Key?

## One-Sentence Positioning

**An API Key is a managed, auditable credential for programmatic access to Stigmer—the same way a deploy token is a managed credential for CI/CD access to a container registry.**

---

## Executive Summary

An ApiKey is a Stigmer IAM resource that grants long-lived programmatic access to the API on behalf of the identity account that created it. It is how your CI/CD pipeline, an MCP server running locally, or any automated system authenticates to Stigmer without presenting a short-lived JWT on every request.

The raw key value is generated once, returned in the create response, and never stored by Stigmer. What is stored is a cryptographic hash and a 6-character fingerprint for identification. This means you control the credential; Stigmer only keeps the proof that the credential exists.

API keys are first-class resources: they have metadata, a lifecycle, configurable expiry, and a `last_used_at` timestamp. You can list all keys tied to your account, rotate them by deleting and recreating, and trace when each was last authenticated.

---

## The Problem API Keys Solve

### Programmatic Auth Is Handled the Wrong Way

Most teams that need non-interactive access to an API fall into one of two traps:

**Trap 1 — Reuse the user's session token:**

```python
# Developer exports their browser session JWT into a CI env var
import os
import requests

headers = {"Authorization": f"Bearer {os.environ['MY_PERSONAL_JWT']}"}
response = requests.get("https://api.stigmer.ai/agents", headers=headers)
```

Short-lived JWTs expire. The pipeline breaks at 3am on a Friday. Someone rotates it by hand. Six months later, nobody knows whose token is running production.

**Trap 2 — Generate a raw token and paste it everywhere:**

```bash
# Generate a token in the Auth0 dashboard
# Copy it into GitHub Secrets, .env files, Kubernetes secrets, and a shared Notion page
# Hope nobody else finds the Notion page
```

The credential has no expiry. There is no central record of where it was used. Rotating it means hunting down every place it was pasted.

**What goes wrong:**

- No expiry: tokens live forever unless someone manually invalidates them.
- No record: there is no list of which tokens exist or when each was last used.
- No rotation path: rotating means finding every system that uses the token—usually discovered only after a leak.
- No fingerprint: if you find a token value somewhere, you cannot identify which credential it is without matching the full string.
- No ownership: shared tokens have no clear owner, so nobody feels responsible for rotating them.

### The Hidden Cost of This Approach

- **No auditability**: "Who was using that token?" becomes unanswerable.
- **No least-privilege**: one token is reused for everything instead of creating scoped credentials.
- **No detection**: there is no `last_used_at` to notice that a credential has been dormant for a year—or that it is suddenly seeing unusual traffic.
- **No governance**: access is granted by distributing a string, with no record in the authorization system.

---

## The Stigmer API Key

### One Credential. Managed Lifecycle. Full Audit Trail.

Stigmer's ApiKey turns a credential from a secret string floating in the wild into a resource you can inspect, rotate, and reason about.

**From creation to rotation, everything is explicit:**

```bash
# 1. Create a key — the raw value is printed once. Save it immediately.
stigmer api-key create ci-key.yaml
# spec.key_hash: sk_live_abc123...xyz789  ← raw key (one-time only)
# spec.fingerprint: xyz789

# 2. Put the raw value in your CI environment
# STIGMER_API_KEY=sk_live_abc123...xyz789

# 3. List all keys — see fingerprints and last usage at a glance
stigmer api-key list

# 4. Rotate: delete the old key, create a replacement
stigmer api-key delete ak-01OLDKEY
stigmer api-key create ci-key-new.yaml
```

### What the YAML Looks Like

```yaml
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: ci-pipeline
  org: acme-corp
spec:
  never_expires: false
  expires_at: "2027-01-01T00:00:00Z"
```

Create it. Save the raw key once. Manage the rest declaratively.

---

## How API Keys Work

### Key Lifecycle

```
Create ──► Save raw key (one-time) ──► Use in integrations ──► Rotate when needed ──► Delete
```

The system stores a hash and a fingerprint. The raw key is yours to keep. Stigmer's backend verifies authentication by hashing the presented value and comparing it to the stored hash—without ever reconstructing the raw key.

### Expiry

| Option | Configuration | Behavior |
|---|---|---|
| **Time-bounded** | `expires_at: "2027-01-01T00:00:00Z"` | Key becomes invalid at that exact UTC timestamp |
| **Never expires** | `never_expires: true` | Key remains valid until explicitly deleted |

Set expiry for any key that belongs to a time-bounded integration—contractor access, temporary tooling, rotating-credential workflows. Use `never_expires` for long-lived automation where you manage rotation manually.

### Fingerprint

The fingerprint (last 6 characters of the raw key) is stored permanently and displayed in `stigmer api-key list`. It lets you identify which physical key corresponds to which resource record without storing the full value.

```
ID              NAME          FINGERPRINT  EXPIRES       LAST USED
ak-01ABC123     ci-pipeline   xyz789       2027-01-01    2026-02-28
ak-01DEF456     local-dev     ab12cd       never         2026-01-15
```

### Last Used

The `status.last_used_at` field records the timestamp of the most recent successful authentication. Use it to:

- Detect dormant credentials (no usage in 90 days → candidate for deletion).
- Spot unexpected activity (usage at unusual hours → investigate).
- Confirm a new key is working (last used matches your first test request).

### Ownership and Authorization

| Operation | Requirement |
|---|---|
| Create a key | Any authenticated user — no FGA check |
| List your keys | Returns only keys owned by the authenticated user |
| Update a key | `can_edit` on the ApiKey resource |
| Delete a key | `can_delete` on the ApiKey resource |

Creating a key requires only authentication. The key is automatically owned by the identity account that created it—no policy setup needed.

---

## How It Compares

| Without Stigmer API Keys | With Stigmer API Keys |
|---|---|
| Raw tokens copy-pasted into CI env vars and Notion docs | Keys are resources with IDs, metadata, and audit trails |
| No expiry — tokens live until manually revoked | Configurable expiry: time-bounded or explicit never-expires |
| No record of which tokens exist | `stigmer api-key list` shows all keys with fingerprints |
| No way to know when a token was last used | `status.last_used_at` on every key |
| Rotation requires hunting down every consumer | Delete and recreate the key resource; fingerprint identifies the old one |
| No fingerprint — full string comparison to identify a token | 6-character fingerprint stored permanently for identification |
| Shared tokens with no clear owner | Every key is owned by the identity account that created it |

---

## Getting Started

```bash
# 1. Create a key YAML
cat > ci-key.yaml << 'EOF'
apiVersion: iam.stigmer.ai/v1
kind: ApiKey
metadata:
  name: ci-pipeline
spec:
  never_expires: false
  expires_at: "2027-01-01T00:00:00Z"
EOF

# 2. Create the key — the raw value is in the response. Save it now.
stigmer api-key create ci-key.yaml

# 3. Set the raw key as your CI environment variable
# STIGMER_API_KEY=sk_live_<raw-value-from-step-2>

# 4. Verify the key is listed
stigmer api-key list

# 5. Check last usage after your first automated run
stigmer api-key get <id-from-step-4> --output yaml
```

---

## Further Reading

- [ApiKey YAML Schema Reference](../../apis/ai/stigmer/iam/apikey/docs/apikey-resource-guide.md) — Complete field documentation
- [Examples](../../apis/ai/stigmer/iam/apikey/docs/examples.md) — Key creation, rotation, and update patterns
- [Validation Checklist](../../apis/ai/stigmer/iam/apikey/docs/validation-checklist.md) — Common pitfalls to avoid
- [What is an Identity Account?](what-is-identity-account.md) — The principal that owns each API key
- [What is an IAM Policy?](what-is-iam-policy.md) — How access is controlled after authentication
