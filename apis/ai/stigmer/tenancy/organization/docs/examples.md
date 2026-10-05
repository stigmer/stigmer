# Organization YAML Examples

Complete examples from minimal to full-featured. All examples use valid field values and can be applied directly.

## Minimal Organization

The simplest possible organization — just a name. The slug is auto-generated from the name.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
spec:
  description: "Acme engineering organization"
```

## Organization (Full)

A fully specified organization with every optional field of a top-level organization set.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
  slug: acme-corp
  labels:
    industry: fintech
    tier: enterprise
  annotations:
    docs-url: "https://internal.acme.com/stigmer"
spec:
  description: "Acme Corp AI agents and automation platform"
  logo_url: "https://acme.com/assets/logo.svg"
```

Key points:
- `slug` is explicit and within the 2–15 character limit
- `parent_org` and `external_id` are omitted: this organization has no parent

## Child Organization

An organization created under a parent organization, here for one of the parent's customers. Creating it needs `can_manage_child_orgs` on the parent (the parent's admins).

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
  slug: acme-corp
spec:
  description: "Acme's workspace, run by Planton"
  parent_org: planton
  external_id: "cust-4411"
```

Key points:
- `parent_org` names the parent by slug or id; the server stores its id. The parent may not itself be a child.
- `external_id` is the parent's own identifier for the child, unique among the parent's children. The parent finds the child with `getByExternalId`, and a sign-in through the parent's identity provider whose `external_id_claim` carries `cust-4411` lands in this organization.
- Both are fixed at creation: an update or apply keeps the stored values.
- Nobody owns the new organization: the parent's admins manage it and grant its first members and owner.

## Organization with Labels for Environment Segregation

Labels enable filtering and organizing resources within or across organizations.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Production
  slug: acme-prod
  labels:
    env: production
    region: us-east
    cost-center: eng-platform
spec:
  description: "Production organization for Acme engineering"
  logo_url: "https://acme.com/assets/logo-prod.svg"
```

## Post-Creation: Updating an Organization

Fields that are **mutable** after creation: `metadata.name`, `metadata.labels`, `metadata.annotations`, `spec.description`, `spec.logo_url`.

Fields that are **immutable** after creation: `spec.parent_org`, `spec.external_id` (an update or apply keeps the stored values).

`metadata.slug` changes only through `rename` (owners only); an update or apply ignores a different slug. The organization's `metadata.id` (`org_…`) never changes, so a rename moves no agent, member or secret, and the old slug keeps leading to the organization for 30 days.

```yaml
# Update — only mutate allowed fields
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp Engineering  # name is mutable
  slug: acme-corp              # a different slug here is ignored; rename changes it
  labels:
    industry: fintech
    tier: enterprise
    updated-by: platform-team  # adding a new label is fine
spec:
  description: "Acme Corp — AI agents for the engineering division"  # mutable
  logo_url: "https://acme.com/assets/logo-v2.svg"                   # mutable
```
