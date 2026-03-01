# Authorization Model

How IamPolicy maps to OpenFGA and how to use the authorization query RPCs.

## OpenFGA Integration

Every IamPolicy is synced to [OpenFGA](https://openfga.dev/) as a relationship tuple. OpenFGA evaluates all runtime authorization checks.

### Tuple Format

An IamPolicy translates to an OpenFGA tuple as follows:

```
principal_kind:principal_id#principal_relation @ resource_kind:resource_id
                                                 └── with relation: spec.relation
```

**Example — user as direct principal:**

```
IamPolicy spec:
  principal: { kind: "identity_account", id: "ia-alice-123" }
  resource:  { kind: "organization",     id: "org-demo-456" }
  relation:  "viewer"

OpenFGA tuple:
  user:   identity_account:ia-alice-123
  relation: viewer
  object: organization:org-demo-456
```

**Example — team members as principal:**

```
IamPolicy spec:
  principal: { kind: "team", id: "tm-eng-789", relation: "member" }
  resource:  { kind: "organization", id: "org-demo-456" }
  relation:  "editor"

OpenFGA tuple:
  user:   team:tm-eng-789#member
  relation: editor
  object: organization:org-demo-456
```

The `principal.relation` qualifier (`#member`) means "the members of team tm-eng-789", not the team entity itself.

## Authorization Check Semantics

The `checkAuthorization` RPC answers: **"Does principal X have permission Y on resource Z?"**

It evaluates the full authorization graph — direct policies, inherited permissions, and group memberships. The result is a simple boolean.

```
Input:
  principal: { kind: "identity_account", id: "ia-alice-123" }
  resource:  { kind: "organization",     id: "org-demo-456" }
  relation:  "viewer"

Output:
  is_authorized: true
```

### When to Use `checkAuthorization`

| Use case | Notes |
|---|---|
| Pre-flight UI checks | Check before showing a button or action to avoid presenting options the user cannot use. |
| API request authorization | Verify the caller is authorized before processing a state-changing operation. |
| Service-to-service authorization | One service checking whether another service's caller has the required permission. |
| Team-based access checks | Resolves team membership automatically — no need to expand the team manually. |

### Contextual Policies

`CheckAuthorizationInput` accepts an optional `contextual_policies` list. These are ephemeral policies evaluated only for this check, without being persisted. Use contextual policies to simulate "what if this additional permission existed" scenarios in pre-flight checks.

## Resource Authorization Queries

### `listAuthorizedResourceIds`

Answers: **"What resource IDs of kind K can principal X access with relation R?"**

```
Input:
  principal:     { kind: "identity_account", id: "ia-alice-123" }
  resource_kind: "organization"
  relation:      "viewer"

Output:
  resource_ids: ["org-demo-456", "org-staging-789"]
```

Use this to filter resource list responses — instead of loading all resources and checking each, query the authorized IDs first, then fetch only those.

### `listAuthorizedPrincipalIds`

Answers: **"What principal IDs of kind K have relation R on resource Z?"** (Inverse of `listAuthorizedResourceIds`.)

```
Input:
  resource:       { kind: "organization", id: "org-demo-456" }
  principal_kind: "identity_account"
  relation:       "viewer"

Output:
  principal_ids: ["ia-alice-123", "ia-bob-456"]
```

Use this for resource access auditing — "who can access this?"

## Relation Semantics

Relations are defined per resource kind in the authorization model. The common set is:

| Relation | Scope | Typical usage |
|---|---|---|
| `owner` | Strongest | Creator of the resource. Full control including deletion and access delegation. |
| `admin` | Strong | Manages the resource and its members. Cannot delete the resource itself. |
| `editor` | Write | Read and modify the resource. No access management capabilities. |
| `viewer` | Read-only | Read the resource. Cannot modify it. |
| `member` | Membership | Basic membership in a group resource (team, organization). |
| `operator` | Platform | Reserved for machine accounts. Used for platform-level system operations. |

Not all relations exist on every resource kind. The specific relations for each resource kind are defined in the OpenFGA authorization model schema.

## Bootstrap Problem and Solution

When a new resource is created, no FGA tuples exist for it yet. The standard `create` RPC requires `can_grant_access` on the resource — but that check cannot pass until at least one ownership tuple exists. This is a chicken-and-egg problem.

The solution is `bootstrapPolicy`: a privileged operator-only RPC that creates the first policies during resource creation, bypassing the standard FGA check. After the bootstrap policies are in place, all subsequent access management uses the standard `create` RPC.

```
Resource creation flow:
  1. Handler creates the resource in the database
  2. Handler calls bootstrapPolicy (as machine account with operator permission):
     - principal: { kind: "organization", id: "org-abc" }
       resource:  { kind: "agent", id: "agt-xyz" }
       relation:  "organization"
     - principal: { kind: "identity_account", id: "ia-creator" }
       resource:  { kind: "agent", id: "agt-xyz" }
       relation:  "owner"
  3. Now the standard authorization model can evaluate all subsequent requests
```

## Related Documentation

- [README.md](README.md) — Overview and core concepts
- [iampolicy-resource-guide.md](iampolicy-resource-guide.md) — YAML schema and CLI reference
- [examples.md](examples.md) — Complete examples for granting, revoking, and checking access
- [validation-checklist.md](validation-checklist.md) — Pre-create checklist and common pitfalls
