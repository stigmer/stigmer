# IamPolicy Validation Checklist and Common Pitfalls

Pre-create checklist and known pitfalls when creating IAM policies.

## Pre-Create Checklist

### Required Fields

- [ ] `apiVersion` is exactly `iam.stigmer.ai/v1`
- [ ] `kind` is exactly `IamPolicy`
- [ ] `metadata.name` is descriptive and identifies the binding (e.g., `alice-org-admin`, not `policy1`)
- [ ] `metadata.org` is set to the organization that owns this policy

### Principal

- [ ] `spec.principal.kind` is a valid resource kind string (e.g., `identity_account`, `team`, `organization`)
- [ ] `spec.principal.id` is the actual resource ID, not a slug or name
- [ ] `spec.principal.relation` is set to `member` or `admin` when the principal kind is `team`
- [ ] The referenced principal resource exists

### Resource

- [ ] `spec.resource.kind` is a valid resource kind string
- [ ] `spec.resource.id` is the actual resource ID, not a slug or name
- [ ] The referenced resource exists

### Relation

- [ ] `spec.relation` is a valid relation for the target resource kind (e.g., `viewer`, `editor`, `admin`, `owner`)
- [ ] The relation is not misspelled — the backend rejects unknown relations

### Authorization

- [ ] The calling identity has `can_grant_access` on the resource being shared

## Common Pitfalls

### Using a Slug or Name Instead of an ID

IDs and slugs are distinct. The `id` field in `ApiResourceRef` requires the system-generated resource ID.

```yaml
# Wrong — using a slug
spec:
  principal:
    kind: identity_account
    id: alice-smith  # slug, not an ID

# Correct — using the system ID
spec:
  principal:
    kind: identity_account
    id: ia-01HQUSER123
```

### Missing `principal.relation` for Team Principals

When the principal kind is `team`, the `relation` qualifier determines which members of the team receive the permission. Omitting it grants access to the team entity itself, which is likely not the intended behavior.

```yaml
# Ambiguous — grants to the team entity, not its members
spec:
  principal:
    kind: team
    id: tm-01HQENGTEAM

# Correct — grants to the team's members
spec:
  principal:
    kind: team
    id: tm-01HQENGTEAM
    relation: member
```

### Invalid `relation` Value

The `relation` field must match a role code defined in the authorization model for the target resource kind. Typos or unsupported relations will fail at creation time.

```yaml
# Wrong — "read" is not a standard relation
spec:
  relation: read

# Correct
spec:
  relation: viewer
```

### Attempting to Use `bootstrapPolicy` Without Operator Permissions

`bootstrapPolicy` and `createPlatformLink` are restricted to machine accounts with `operator` permission on `platform:stigmer`. Calling them as a regular user will return an authorization error.

### Deleting a Policy That Doesn't Exist Is Safe

The `delete` operation is idempotent. If the policy does not exist, the call succeeds without error. There is no need to check for existence before deleting.

### Creating a Duplicate Policy Is Safe

The `create` operation is idempotent. If the exact policy (same principal, resource, and relation) already exists, the call succeeds and returns the existing policy. No duplicate is created.
