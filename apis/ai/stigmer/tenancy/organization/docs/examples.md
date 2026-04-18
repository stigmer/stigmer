# Organization YAML Examples

Complete examples from minimal to full-featured. All examples use valid field values and can be applied directly.

## Minimal Organization

The simplest possible organization — just a name. The slug is auto-generated from the name, management mode defaults to `self_managed`.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp
spec:
  description: "Acme engineering organization"
```

## Self-Managed Organization (Full)

A fully specified self-managed organization with all optional fields set.

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
  management_mode: self_managed
```

Key points:
- `slug` is explicit and within the 2–15 character limit
- `management_mode: self_managed` is the default and can be omitted
- `identity_provider_ref` must be omitted for self-managed organizations

## Platform-Managed Organization

An organization created and controlled by an external platform via an IdentityProvider. The platform authenticates users and manages membership on behalf of the organization.

```yaml
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Planton
  slug: acme-planton
spec:
  description: "Acme organization managed by Planton"
  management_mode: platform_managed
  identity_provider_ref:
    org: stigmer
    kind: identity_provider
    slug: planton-idp
  external_org_id: "planton-org-7a3f2c91"
```

Key points:
- `management_mode: platform_managed` is **immutable** — cannot be changed after creation
- `identity_provider_ref` is required; it must reference an existing, active IdentityProvider
- `external_org_id` lets the platform look up this Stigmer org using its own identifier, even if the Stigmer slug differs from the platform's original slug due to availability
- The slug (`acme-planton`) may differ from the platform's slug for the same organization — `external_org_id` bridges the gap

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

Fields that are **immutable** after creation: `metadata.slug`, `spec.management_mode`, `spec.identity_provider_ref`, `spec.external_org_id`.

```yaml
# Update — only mutate allowed fields
apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Acme Corp Engineering  # name is mutable
  slug: acme-corp              # slug is immutable; must match existing value
  labels:
    industry: fintech
    tier: enterprise
    updated-by: platform-team  # adding a new label is fine
spec:
  description: "Acme Corp — AI agents for the engineering division"  # mutable
  logo_url: "https://acme.com/assets/logo-v2.svg"                   # mutable
  management_mode: self_managed  # immutable; must match existing value
```
