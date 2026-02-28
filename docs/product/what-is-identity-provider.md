# What is an Identity Provider?

## One-Sentence Positioning

**An Identity Provider is a declarative trust configuration that lets an external platform's users access Stigmer without creating a separate account—the same way an OAuth app registration lets users log in with Google without creating a new password.**

---

## Executive Summary

An IdentityProvider is a Stigmer IAM resource that configures a trust relationship between Stigmer and an external platform. Once registered, the external platform can exchange its users' OIDC access tokens for Stigmer-native tokens. Stigmer validates the token signature, fetches the user's profile from the platform's UserInfo endpoint, and automatically provisions a federated [IdentityAccount](what-is-identity-account.md) for the user on first access—no manual signup required.

The IdentityProvider contains only public validation configuration: the JWKS endpoint for signature verification, the allowed issuers, the expected audience, and the UserInfo endpoint. No client secrets or private keys are stored. The trust is established by the cryptographic properties of the OIDC tokens—not by a shared secret.

For the platform, registering an IdentityProvider is a one-time configuration. Every user of that platform who needs access to Stigmer gains it automatically the first time they authenticate through the token exchange. Profile data (email, name, picture) stays fresh because it is re-fetched on every token exchange, not just on first provision.

---

## The Problem Identity Providers Solve

### Federated Authentication Is Built the Wrong Way

Most platforms that want to let their users access a third-party API handle it by distributing credentials:

**Typical approach:**

```python
# Platform generates API keys for each user and stores them
def provision_user_access(user_id: str) -> str:
    # Call the third-party API to create a credential
    api_key = third_party.create_api_key(name=f"user-{user_id}")
    db.insert("user_credentials", {
        "user_id": user_id,
        "third_party_api_key": encrypt(api_key),
    })
    return api_key

# Every API call proxied through the platform using the stored key
def call_third_party(user_id: str, payload: dict):
    key = decrypt(db.get("user_credentials", user_id=user_id)["third_party_api_key"])
    return requests.post(THIRD_PARTY_API, headers={"Authorization": f"Bearer {key}"}, json=payload)
```

This works for small scale. It breaks down at platform scale.

**What goes wrong:**

- Every user gets a separate API key. The platform manages a database of credentials on behalf of its users. This is a credential storage problem the platform never needed to own.
- API keys are long-lived and static. If the third-party API rotates keys, the platform must re-provision every user. If a key leaks, the blast radius is one user's key—but that is still a manual rotation.
- The platform proxies every API call through its own servers to inject the credential. There is no path for users to call the third-party API directly.
- Adding a new user means an explicit provisioning step. There is no automatic account creation on first access.
- The third-party service has no way to verify who is actually calling—it knows the API key, not the human behind it. Authorization is blind to identity.

### The Hidden Cost of This Approach

- **Credential management overhead**: the platform owns the storage, rotation, and revocation of third-party credentials for every user.
- **No direct access**: users cannot call the API directly; all traffic must be proxied through the platform.
- **No identity context**: the third-party service cannot attribute actions to specific users—only to the platform's machine account.
- **No JIT provisioning**: onboarding a new user is a multi-step process, not an automatic first-access event.
- **No freshness**: user profile data in the third-party system goes stale because it is captured once at provisioning, not refreshed continuously.

---

## The Stigmer Identity Provider

### One Registration. Any User. Automatic Provisioning.

Stigmer's IdentityProvider turns federated access into a configuration problem, not a credential management problem. The platform registers once. Every user gets automatic JIT provisioning on first token exchange. No credential storage, no proxying, no manual onboarding steps.

**From registration to first user access:**

```bash
# 1. Register the identity provider (one-time, by the platform admin)
stigmer identity-provider create planton-idp.yaml

# 2. A user authenticates on the external platform
# 3. The platform exchanges the user's OIDC token
#    POST /token-exchange
#    Authorization: Bearer <platform_access_token>
# 4. Stigmer validates, provisions the user, issues a Stigmer token
# 5. The user calls Stigmer APIs directly using their Stigmer token
#    — no credential database, no proxy layer
```

### What the YAML Looks Like

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: Planton Cloud
  slug: planton-cloud
  org: planton
spec:
  display_name: "Planton Cloud"
  jwks_uri: "https://planton-prod.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://planton-prod.us.auth0.com/"
  expected_audience: "https://api.planton.ai/"
  userinfo_endpoint: "https://planton-prod.us.auth0.com/userinfo"
  rate_limit_budget: 1000
```

Register it once. Every user of Planton Cloud can now access Stigmer.

---

## Architecture: The Token Exchange Flow

```
External Platform                    Stigmer
──────────────────                   ───────
User authenticates
  on the platform        ──────────► POST /token-exchange
                                       │
                               Fetch JWKS from jwks_uri
                               Verify JWT signature
                               Validate iss (allowed_issuers)
                               Validate aud (expected_audience)
                                       │
                               Fetch user profile
                               from userinfo_endpoint
                                       │
                            First time?  ──► Create federated IdentityAccount
                            Returning?   ──► Update profile fields
                                       │
                               Issue Stigmer-native token
                                       │
                         ◄─────────────┘
                     User calls Stigmer APIs
                     directly with native token
```

| Component | Role |
|---|---|
| **IdentityProvider** | The trust configuration. Declares how Stigmer validates tokens from this platform. |
| **JWKS endpoint** | Public key store for JWT signature verification. Fetched and cached by Stigmer. |
| **UserInfo endpoint** | OIDC endpoint that returns the user's profile. Called on every token exchange. |
| **IdentityAccount (federated)** | The principal created for the user. Identified by a compound `idp_id`. |
| **Stigmer-native token** | The token issued after successful exchange. Used for all subsequent API calls. |

---

## The Four Configuration Fields That Matter

### 1. `jwks_uri` — The Key Source

Stigmer fetches public signing keys from this URL to verify token signatures. For Auth0-based platforms, this is the standard JWKS endpoint:

```yaml
spec:
  jwks_uri: "https://my-tenant.us.auth0.com/.well-known/jwks.json"
```

Stigmer caches the keys and re-fetches on cache miss, supporting key rotation without any configuration change.

### 2. `allowed_issuers` — The Trust Boundary

Every token's `iss` claim must exactly match one of these values. This is the first gate that ensures the token came from the right place.

```yaml
spec:
  allowed_issuers:
    - "https://my-tenant.us.auth0.com/"  # trailing slash matters — must match iss exactly
```

Use multiple values to support staging and production environments from the same IdentityProvider registration.

### 3. `expected_audience` — The Audience Lock

Every token's `aud` claim must match this value. This prevents tokens minted for other services (e.g., the platform's own API) from being used to access Stigmer.

```yaml
spec:
  expected_audience: "https://api.myplatform.com/"  # the API identifier in Auth0
```

### 4. `userinfo_endpoint` — The Profile Source

Stigmer calls this endpoint with the platform's access token on every token exchange to fetch the user's current profile. This keeps the federated IdentityAccount's email, name, and picture fresh without any manual synchronization.

```yaml
spec:
  userinfo_endpoint: "https://my-tenant.us.auth0.com/userinfo"
```

---

## How It Compares

| Without Stigmer Identity Providers | With Stigmer Identity Providers |
|---|---|
| Platform manages a database of API keys for every user | No credential storage — trust is established cryptographically via OIDC |
| All API calls proxied through the platform to inject credentials | Users call Stigmer directly using their Stigmer-native token |
| New user requires explicit provisioning step | First token exchange automatically provisions a federated IdentityAccount |
| User profile goes stale after initial provisioning | Profile re-fetched from UserInfo endpoint on every token exchange |
| Third-party service cannot attribute actions to specific users | Every API call traces to a `federated:` IdentityAccount — full attribution |
| Adding a new identity provider requires plumbing a new auth path | Register one IdentityProvider YAML; token exchange handles every user |
| No standard model for audience or issuer validation | `allowed_issuers` and `expected_audience` are explicit, auditable configuration |

---

## Getting Started

```bash
# 1. Create an identity provider YAML
cat > idp.yaml << 'EOF'
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: My Platform
  slug: my-platform
  org: my-org
spec:
  display_name: "My Platform"
  jwks_uri: "https://my-tenant.us.auth0.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://my-tenant.us.auth0.com/"
  expected_audience: "https://api.myplatform.com/"
  userinfo_endpoint: "https://my-tenant.us.auth0.com/userinfo"
EOF

# 2. Register it
stigmer identity-provider create idp.yaml

# 3. Test a token exchange (from your platform's backend)
curl -X POST https://api.stigmer.ai/token-exchange \
  -H "Authorization: Bearer <platform_access_token>" \
  -H "X-Identity-Provider: my-org/my-platform"
# Returns: { "access_token": "stigmer_native_token" }

# 4. Verify the federated account was created
stigmer identity-account whoami --token <stigmer_native_token_from_step_3>
# provisioning_mode: federated
# identity_provider_ref: { org: my-org, kind: identity_provider, slug: my-platform }
```

---

## Further Reading

- [IdentityProvider YAML Schema Reference](../../apis/ai/stigmer/iam/identityprovider/docs/identityprovider-resource-guide.md) — Complete field documentation
- [Token Exchange Flow](../../apis/ai/stigmer/iam/identityprovider/docs/token-exchange-flow.md) — Step-by-step flow, OIDC standards, key caching, and security model
- [Examples](../../apis/ai/stigmer/iam/identityprovider/docs/examples.md) — Single-environment, multi-environment, and rate-limited configurations
- [Validation Checklist](../../apis/ai/stigmer/iam/identityprovider/docs/validation-checklist.md) — Common pitfalls including trailing slash in `allowed_issuers`
- [What is an Identity Account?](what-is-identity-account.md) — The federated IdentityAccount that gets provisioned on first token exchange
- [What is an IAM Policy?](what-is-iam-policy.md) — How federated users are granted access to Stigmer resources
