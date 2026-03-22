# What is an Identity Account?

## One-Sentence Positioning

**An Identity Account is Stigmer's canonical representation of any entity that can be granted permissions—the same way a Unix user account is the canonical principal that all filesystem permissions are assigned to.**

---

## Executive Summary

An IdentityAccount is a Stigmer IAM resource that represents a user or machine principal in the authorization model. Every entity that can be granted access to a Stigmer resource—a human who logged in, a service that authenticates via client credentials, or a user federated from an external platform—has a corresponding IdentityAccount.

All Fine-Grained Authorization (FGA) tuples use `identity_account` as the principal type. When you grant Alice viewer access to an organization, the permission is not granted to "the string 'alice@example.com'"—it is granted to `identity_account:ia-01HQALICE123`. The IdentityAccount is the stable, system-assigned identity anchor that outlives any change to the user's email or profile.

IdentityAccounts are created automatically—via Auth0 signup webhooks, Just-In-Time (JIT) federated provisioning, or platform bootstrapping for machine accounts. They are not created by users directly. Once created, the account's profile (name, picture) can be updated, but its identity anchor (`idp_id`) is immutable.

---

## The Problem Identity Accounts Solve

### User Identity Is Handled the Wrong Way

Most applications manage user identity by treating the email address or external provider ID as the primary key:

**Typical approach:**

```python
# Grant access using the email as the principal
def grant_access(email: str, resource_id: str, role: str):
    db.insert("permissions", {
        "principal_email": email,
        "resource_id": resource_id,
        "role": role,
    })

# Check access by looking up the email
def check_access(request_email: str, resource_id: str, required_role: str):
    row = db.find("permissions", principal_email=request_email, resource_id=resource_id)
    return row and row["role"] == required_role
```

This works for a single application. It breaks the moment identity becomes complex.

**What goes wrong:**

- The email is both the identity and the lookup key. If a user changes their email, all their permissions break—or you have to run a migration across every table that stores the email.
- Machine accounts have no email. The model breaks for any non-human principal.
- Federated users from an external platform have an external subject ID, not an email. You need a different lookup path for every identity provider.
- There is no central record of all principals in the system. "Who has ever been granted access to anything?" requires scanning every permission table in every service.
- The user's identity context (name, picture, provisioning source) is scattered across the application—or lost entirely because the permission table only stores the email.

### The Hidden Cost of This Approach

- **No stable identity anchor**: email changes break every permission grant associated with the old email.
- **No machine support**: service accounts require special-casing everywhere the identity model is touched.
- **No federation**: adding an external identity provider requires plumbing a new lookup path through every authorization check.
- **No central principal registry**: you cannot audit which principals exist, how they were created, or whether a given account is still active.
- **No provenance**: there is no record of whether an account was a direct signup, a federated JIT provision, or a machine credential.

---

## The Stigmer Identity Account

### One Principal Type. Any Identity Source. Complete Authorization Model.

Stigmer assigns every identity—regardless of how it was created—a stable, system-generated ID with the prefix `ia-`. This ID is the only thing stored in permission grants. The user's email, name, and picture are metadata on the account. They can change without affecting any permission.

**Every identity flows through the same principal type:**

```
Direct signup (Auth0)
  └─► ia-01HQDIRECT  ──► can_view  ──► organization:org-abc

Federated user (external platform)
  └─► ia-01HQFED     ──► can_edit  ──► agent:agt-xyz

Machine account (M2M service)
  └─► ia-01HQMACHINE ──► operator  ──► platform:stigmer
```

**The same authorization check works for all three:**

```bash
stigmer iam-policy check-authorization \
  --principal-kind identity_account \
  --principal-id ia-01HQFED \
  --resource-kind agent \
  --resource-id agt-xyz \
  --relation editor
# is_authorized: true
```

### What the Resource Looks Like

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IdentityAccount
metadata:
  id: ia-01HQALICE123
  name: Alice Smith
spec:
  idp_id: "auth0|abc123def456"
  email: alice@example.com
  first_name: Alice
  last_name: Smith
  picture_url: "https://cdn.example.com/alice.jpg"
  is_machine_account: false
  provisioning_mode: direct
```

---

## Architecture: Where Identity Accounts Fit

IdentityAccounts are the root principal in Stigmer's entire authorization graph.

```
Auth0 Signup ────────────────────────┐
                                     ▼
External Platform ──► Token Exchange ──► IdentityAccount ──► IamPolicy ──► Resource
                                     ▲
M2M Bootstrap ───────────────────────┘
```

| Component | Role |
|---|---|
| **IdentityAccount** | The stable, system-assigned principal. All permission grants reference this ID. |
| **IamPolicy** | Binds the IdentityAccount to a resource with a specific relation. |
| **Auth0** | The external identity provider for direct accounts. Fires a webhook on signup that creates the IdentityAccount. |
| **IdentityProvider** | A registered external platform. Triggers JIT provisioning of a federated IdentityAccount during token exchange. |
| **`idp_id`** | The immutable external identity anchor. Unique across all accounts. Never changes. |

---

## The Three Provisioning Modes

### 1. Direct — Auth0 Signup

When a user signs up through Stigmer's own Auth0 tenant, Auth0 fires a signup webhook. The webhook handler creates a direct IdentityAccount with the Auth0 subject ID as `idp_id`.

```yaml
spec:
  idp_id: "auth0|abc123def456"
  provisioning_mode: direct
```

- The user can log in to Stigmer directly.
- Profile data comes from the Auth0 identity (Google, GitHub, email/password).

### 2. Federated — Just-In-Time via IdentityProvider

When an external platform exchanges a user's OIDC token for a Stigmer-native token, Stigmer JIT-provisions a federated IdentityAccount on first use. The `idp_id` is a compound key that encodes the provider and the external subject.

```yaml
spec:
  idp_id: "federated:idp_01JXY123:auth0|user-456"
  provisioning_mode: federated
  identity_provider_ref:
    org: partner-org
    kind: identity_provider
    slug: partner-cloud
```

- The account **cannot** log in to Stigmer directly — it has no credentials in Stigmer's Auth0.
- Profile data (email, name, picture) is fetched from the IdentityProvider's UserInfo endpoint and refreshed on every token exchange.
- This is how platforms integrate their users into Stigmer without requiring a separate Stigmer signup.

### 3. Machine — M2M Client Credentials

Machine accounts represent Auth0 M2M applications used for inter-service communication. They are identified by `@clients` suffix in `idp_id` and are created during platform bootstrapping.

```yaml
spec:
  idp_id: "HqKdZn9xyzABC@clients"
  is_machine_account: true
  provisioning_mode: machine
```

- The account authenticates via client credentials, not user login.
- Used for internal services that call Stigmer APIs on behalf of themselves, not on behalf of a user.

---

## The `whoAmI` Operation

Any authenticated caller can ask Stigmer: "Which IdentityAccount am I?"

```bash
stigmer identity-account whoami
```

This is the entry point for any integration that needs to discover its own principal ID—for example, before constructing an IAM policy grant or looking up its own permissions.

---

## How It Compares

| Without Stigmer Identity Accounts | With Stigmer Identity Accounts |
|---|---|
| Email used as principal — breaks when email changes | Stable `ia-` prefixed ID; email is metadata that can change freely |
| Machine accounts require special-casing in every auth check | Machine accounts are IdentityAccounts with `is_machine_account: true` — same model, same auth path |
| Federated users need a separate lookup path per external provider | All provisioning modes produce an IdentityAccount — authorization checks are identical |
| No central registry of all principals | `stigmer identity-account list` shows every principal in the system |
| No record of how an account was provisioned | `provisioning_mode` and `identity_provider_ref` preserve full provenance |
| Profile metadata (name, picture) not linked to identity | Name, picture, and email are stored on the IdentityAccount alongside the identity anchor |
| No way to recover an account created in Auth0 but missed by the system | `simulateSignupWebhook` re-triggers account creation for missed signups |

---

## Getting Started

```bash
# 1. Find out who you are
stigmer identity-account whoami

# 2. Get a specific account by ID
stigmer identity-account get ia-01HQALICE123

# 3. Get a specific account by email
stigmer identity-account get --email alice@example.com

# 4. Update profile fields (first_name, last_name, picture_url)
stigmer identity-account update updated-profile.yaml

# 5. Recover a missed account (exists in Auth0 but not in Stigmer)
stigmer identity-account simulate-signup-webhook --email alice@example.com
```

---

## Further Reading

- [IdentityAccount YAML Schema Reference](../../apis/ai/stigmer/iam/identityaccount/docs/identityaccount-resource-guide.md) — Complete field documentation
- [Provisioning Modes](../../apis/ai/stigmer/iam/identityaccount/docs/provisioning-modes.md) — Detailed flows for direct, federated, and machine accounts
- [Examples](../../apis/ai/stigmer/iam/identityaccount/docs/examples.md) — whoAmI, profile updates, federated and machine account shapes
- [Validation Checklist](../../apis/ai/stigmer/iam/identityaccount/docs/validation-checklist.md) — Common pitfalls including ID vs IDP ID confusion
- [What is an IAM Policy?](what-is-iam-policy.md) — How IdentityAccounts are used as principals in access grants
- [What is an Identity Provider?](what-is-identity-provider.md) — How external platforms provision federated IdentityAccounts
