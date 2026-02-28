# What is an IAM Policy?

## One-Sentence Positioning

**An IAM Policy is a declarative, auditable access grant—the same way a Kubernetes RBAC RoleBinding declaratively grants a ServiceAccount permission to perform operations on cluster resources.**

---

## Executive Summary

An IamPolicy is a Stigmer IAM resource that binds a principal (who), a permission (what), and a resource (which) into a single, persisted access record. Every authorization decision in Stigmer—whether a user can view an organization, edit an agent, or deploy to an environment—traces back to one or more IamPolicy records.

Each policy is a statement of fact: "This identity account has this relation on this resource." Policies are synced to [OpenFGA](https://openfga.dev/) as relationship tuples, where all runtime authorization checks are evaluated. The IamPolicy is the source of truth; OpenFGA is the enforcement engine.

IamPolicies are declarative and idempotent. Creating a policy that already exists is a no-op. Deleting a policy that does not exist is a no-op. Revoking access is as explicit as granting it—you remove the policy, and the change propagates to the authorization engine immediately.

---

## The Problem IAM Policies Solve

### Access Control Is Implemented the Wrong Way

Most teams manage authorization by writing permission checks directly into application code:

**Typical ad-hoc approach:**

```python
def deploy_environment(user_id: str, env_id: str):
    user = db.get_user(user_id)
    env = db.get_environment(env_id)

    # Is the user in the right org? Are they an admin?
    if user.org_id != env.org_id:
        raise PermissionError("Wrong org")
    if user.role not in ("admin", "owner"):
        raise PermissionError("Not an admin")

    # What about teams? What about inherited permissions?
    # What about cross-org grants? What about machine accounts?
    ...
```

This works for the simple case. It breaks the moment requirements grow.

**What goes wrong:**

- Permission logic is scattered across every handler and service. When the access model changes, you find permission checks in 40 different places—and miss three.
- There is no central record of who can access what. "Who has admin access to this environment?" requires a full database scan, not a single query.
- Teams are an afterthought. Adding team-based access means rewriting every permission check to handle membership lookups.
- Inherited permissions are never implemented. Nobody has time to build transitive permission resolution, so everything requires explicit grants.
- There is no audit trail at the policy level. You can see what a user did, but not why they were authorized to do it at that moment.

### The Hidden Cost of This Approach

- **No query model**: you cannot answer "what can this user access?" without writing a custom traversal across every resource type.
- **No teams**: group-based access control becomes a project, not a feature.
- **No inheritance**: every permission must be granted explicitly because there is no authorization graph.
- **No auditability**: access grants and revocations are buried in application logs, not in a dedicated record.
- **No standard revocation**: removing access means finding and deleting records across multiple tables in multiple services.

---

## The Stigmer IAM Policy

### One Record. Complete Authorization Model. Instant Revocation.

Stigmer separates the *declaration* of access grants from the *enforcement* of authorization checks. IamPolicies are the declarations—stored, versioned, and queryable. OpenFGA is the enforcement—a purpose-built authorization database that evaluates the full permission graph in milliseconds.

**Grant access, check it, and revoke it—all declaratively:**

```bash
# Grant Alice viewer access to the Demo organization
stigmer iam-policy create alice-demo-viewer.yaml

# Check: does Alice have viewer access?
stigmer iam-policy check-authorization \
  --principal-kind identity_account --principal-id ia-alice-123 \
  --resource-kind organization --resource-id org-demo-456 \
  --relation viewer
# is_authorized: true

# Revoke it
stigmer iam-policy delete alice-demo-viewer.yaml
# is_authorized: false (immediately)
```

### What the YAML Looks Like

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-demo-org-viewer
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQALICE123
  resource:
    kind: organization
    id: org-01HQDEMO456
  relation: viewer
```

Grant it. Query it. Revoke it. The authorization model updates instantly.

---

## Architecture: Where IAM Policies Fit

IAM Policies are the connective tissue of the entire Stigmer resource hierarchy.

```
identity_account ──► IamPolicy ──► organization
identity_account ──► IamPolicy ──► agent
identity_account ──► IamPolicy ──► environment
team#member      ──► IamPolicy ──► mcp_server
organization     ──► IamPolicy ──► agent (scope link)
```

| Component | Role |
|---|---|
| **IamPolicy** | Declares the access grant. The source of truth. Persisted in the database. |
| **OpenFGA** | Enforces the grant. Evaluates authorization checks against the full relationship graph. |
| **Principal** | The entity receiving the permission: `identity_account`, `team`, `organization`, or any resource that acts as an identity. |
| **Resource** | The entity being protected: `organization`, `agent`, `environment`, `mcp_server`, or any Stigmer resource. |
| **Relation** | The permission level: `owner`, `admin`, `editor`, `viewer`, `member`, or any relation defined for that resource kind. |

---

## The Three Building Blocks of an IAM Policy

### 1. Principal — Who Gets Access

The principal is the entity receiving the permission. It is an `ApiResourceRef` with a kind and an ID.

**Individual user:**

```yaml
spec:
  principal:
    kind: identity_account
    id: ia-01HQALICE123
```

**Team members (group-based access):**

```yaml
spec:
  principal:
    kind: team
    id: tm-01HQENGINEERING
    relation: member  # all members of this team receive the permission
```

The `relation` qualifier on the principal is distinct from `spec.relation` (which is the permission being granted). For team principals, `relation: member` means "every identity account that has the 'member' relation on this team."

### 2. Resource — What Is Being Protected

The resource is the entity being protected. Any Stigmer API resource can be a resource in an IAM policy.

```yaml
spec:
  resource:
    kind: organization
    id: org-01HQDEMO456
```

Common resource kinds: `organization`, `environment`, `agent`, `mcp_server`, `skill`, `cloud_resource`, `identity_account`.

### 3. Relation — What Permission Is Granted

The relation maps to a role code defined in the authorization model for that resource kind.

| Relation | Access Level |
|---|---|
| `owner` | Full control including deletion and access delegation |
| `admin` | Full control excluding deletion |
| `editor` | Read and write; no access management |
| `viewer` | Read-only |
| `member` | Basic membership in a group resource |
| `operator` | Platform-level system operations (reserved for machine accounts) |

The available relations depend on the resource kind. Not every resource kind supports every relation.

---

## Authorization Queries

IamPolicies are not just for granting access—they power authorization queries that answer questions about the permission graph.

### Check Authorization (Boolean)

"Does this principal have this relation on this resource?"

```bash
stigmer iam-policy check-authorization \
  --principal-kind identity_account \
  --principal-id ia-01HQALICE123 \
  --resource-kind organization \
  --resource-id org-01HQDEMO456 \
  --relation admin
# is_authorized: false

# Alice is a viewer, not an admin
```

Use this for pre-flight checks before showing UI elements or processing API requests.

### List Authorized Resources

"What are all the [resource kind] that this principal can access with this relation?"

```bash
stigmer iam-policy list-authorized-resources \
  --principal-kind identity_account \
  --principal-id ia-01HQALICE123 \
  --resource-kind organization \
  --relation viewer
# resource_ids: [org-01HQDEMO456, org-01HQSTAGING789]
```

Use this to filter resource list responses—fetch only the IDs the caller can access, then load those resources.

### List Authorized Principals

"Who has this relation on this resource?" (The inverse query.)

```bash
stigmer iam-policy list-authorized-principals \
  --resource-kind organization \
  --resource-id org-01HQDEMO456 \
  --principal-kind identity_account \
  --relation admin
# principal_ids: [ia-01HQBOB, ia-01HQCHARLIE]
```

Use this for access audit views—"who can administer this organization?"

---

## How It Compares

| Without Stigmer IAM Policies | With Stigmer IAM Policies |
|---|---|
| Permission checks scattered across every API handler | One declarative record per grant; enforcement is centralized in OpenFGA |
| "Who has access to this resource?" requires a custom database query | `list-authorized-principals` answers it in milliseconds |
| Team-based access is a multi-sprint project | `principal.relation: member` grants access to every team member in one policy |
| No inheritance—every permission must be granted explicitly | OpenFGA evaluates transitive relationships across the full permission graph |
| Revoking access requires finding and deleting records across multiple tables | Delete one IamPolicy; the change propagates to OpenFGA immediately |
| No audit trail at the policy level | Every grant and revocation is a resource with `created_by`, `created_at` |
| Authorization logic cannot be queried without loading application data | Authorization queries run against OpenFGA, not your application database |

---

## Getting Started

```bash
# 1. Create a policy YAML
cat > grant-access.yaml << 'EOF'
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-demo-org-viewer
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQALICE123
  resource:
    kind: organization
    id: org-01HQDEMO456
  relation: viewer
EOF

# 2. Grant the access
stigmer iam-policy create grant-access.yaml

# 3. Verify it
stigmer iam-policy check-authorization \
  --principal-kind identity_account \
  --principal-id ia-01HQALICE123 \
  --resource-kind organization \
  --resource-id org-01HQDEMO456 \
  --relation viewer

# 4. See what Alice can access
stigmer iam-policy list-authorized-resources \
  --principal-kind identity_account \
  --principal-id ia-01HQALICE123 \
  --resource-kind organization \
  --relation viewer

# 5. Revoke when done
stigmer iam-policy delete grant-access.yaml
```

---

## Further Reading

- [IamPolicy YAML Schema Reference](../../apis/ai/stigmer/iam/iampolicy/docs/iampolicy-resource-guide.md) — Complete field documentation
- [Authorization Model](../../apis/ai/stigmer/iam/iampolicy/docs/authorization-model.md) — OpenFGA integration, tuple format, query semantics
- [Examples](../../apis/ai/stigmer/iam/iampolicy/docs/examples.md) — Grant, revoke, and authorization query examples
- [Validation Checklist](../../apis/ai/stigmer/iam/iampolicy/docs/validation-checklist.md) — Common pitfalls including ID vs slug confusion
- [What is an Identity Account?](what-is-identity-account.md) — The principal type used in most IAM policies
- [What is an Identity Provider?](what-is-identity-provider.md) — How federated users are provisioned as identity accounts
