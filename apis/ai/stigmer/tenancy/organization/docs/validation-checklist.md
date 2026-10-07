# Validation Checklist and Common Pitfalls

Pre-apply checklist and known pitfalls when authoring Organization YAML files.

## Pre-Apply Checklist

Run through this list before applying an Organization YAML with `stigmer org apply`.

### Required Fields

- [ ] `apiVersion` is exactly `tenancy.stigmer.ai/v1`
- [ ] `kind` is exactly `Organization`
- [ ] `metadata.name` is present
- [ ] `spec.description` clearly explains the organization's purpose (strongly recommended — organizations without descriptions render poorly in the UI)

### Slug Constraints

- [ ] `metadata.slug` (if set) is **2–15 characters** — shorter than most other resources
- [ ] `metadata.slug` contains only lowercase letters, numbers, and hyphens
- [ ] `metadata.slug` starts with a lowercase letter
- [ ] `metadata.slug` has no underscores or uppercase letters
- [ ] `metadata.slug` is not another organization's slug, or one another organization was renamed away from in the last 30 days

### Child Organization (only when `spec.parent_org` is set)

- [ ] `spec.parent_org` is set intentionally — it is **immutable after creation**
- [ ] You manage the parent (`can_manage_child_orgs`: its admins), and the parent is not itself a child
- [ ] `spec.external_id`, when set, is the parent's own identifier for the child and unused among the parent's children
- [ ] `spec.external_id` is not set without `spec.parent_org`

### YAML Syntax

- [ ] YAML is properly formatted and syntactically valid
- [ ] No trailing whitespace or tab characters in YAML values
- [ ] `spec.description` does not exceed 500 characters
- [ ] `spec.logo_url` does not exceed 2048 characters

## Common Pitfalls

### Slug too long

Organization slugs have a maximum of **15 characters** — much shorter than the 63-character limit on other resources like agents and skills.

```yaml
# Wrong — slug exceeds 15 characters
metadata:
  slug: my-engineering-org

# Correct
metadata:
  slug: my-eng-org
```

### Slug starts with a number

```yaml
# Wrong — must start with a lowercase letter
metadata:
  slug: 2acme

# Correct
metadata:
  slug: acme2
```

### Slug uses underscores

```yaml
# Wrong
metadata:
  slug: acme_corp

# Correct
metadata:
  slug: acme-corp
```

### Setting `external_id` without `parent_org`

`external_id` is the parent's identifier for a child organization, so it is refused on an organization that names no parent.

```yaml
# Wrong — external_id needs parent_org
spec:
  external_id: "cust-4411"

# Correct
spec:
  parent_org: planton
  external_id: "cust-4411"
```

### Naming a child organization as the parent

Child organizations are one level deep. A create whose `parent_org` is itself a child is refused with `FAILED_PRECONDITION` carrying `ORGANIZATION_PARENT_IS_CHILD`.

### Reusing an external id

An external id identifies one child among its parent's children. A second child of the same parent with the same `external_id` is refused with `ALREADY_EXISTS`; another parent may use the same value.

### Trying to change `parent_org` or `external_id` after creation

Both are fixed at creation. An `apply` or `update` that carries different values keeps the stored ones; a child is never moved to another parent.

### Attempting to change the slug after creation

An update or apply ignores a different `metadata.slug`; the slug changes only through `rename`, which owners may call. An apply that names the organization only by a new slug finds no organization under it and creates a second one, so carry the organization's `metadata.id` (as `get -o yaml` prints it) when editing a manifest: the CLI's `apply` then sends the new slug through `rename` for you.

```yaml
# Renames acme-corp to acme: the id names the organization,
# and the CLI follows the apply with a rename
metadata:
  id: org_01j9w3k7m2x4n6p8q0r2s4t6v8
  slug: acme  # was acme-corp
```

Always use `stigmer org get <slug>` to confirm the existing slug before updating.

### Deleting an organization without accounting for what it holds

Deleting an organization is irreversible. Its members lose access to
everything under it: agents, MCP servers, skills, sessions and runs. Its slug is released: a later organization may take it, and
that organization reaches nothing the deleted one owned, because every
resource names its organization by id.

On a server that holds one organization, the open-source edition, that
organization cannot be deleted at all: the delete is refused with
`ORGANIZATION_IS_SINGLE` before anything is written. The same server refuses
a second organization with `ORGANIZATION_LIMIT_REACHED`.

An organization that still has child organizations cannot be deleted
either: the delete is refused with `ORGANIZATION_HAS_CHILDREN` until every
child is deleted.

```bash
# Verify contents before deleting
stigmer list agents --org my-org
stigmer list sessions --org my-org

# Then delete
stigmer org delete my-org
```
