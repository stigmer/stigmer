# DD-001: Separate Identity and Authorization Controls

**Date**: 2026-04-16
**Status**: Approved
**Context**: JIT Provisioning design for IdentityProvider

## Decision

Auto-provisioning (identity) and auto-granting (authorization) are modeled as two independent boolean fields on `IdentityProviderSpec`, not as a single enum or a sentinel role value.

## Why Not a Single `default_org_role` Field?

The initial design used `default_org_role = iam_role_unspecified` to mean "don't auto-grant." This is a sentinel value that conflates two distinct domain concerns:

- **Identity provisioning**: "Does Stigmer recognize this person?" (creating `IdentityAccount`)
- **Access granting**: "What can this person do?" (creating `IamPolicy`)

Using a role value to express "don't do the authorization step at all" is architecturally anemic. It forces the consumer to understand that `unspecified` is a magic value meaning "skip," which is not self-documenting.

## Why Not a `federation_mode` Enum?

An enum like `{ manual, auto_provision, auto_provision_with_access }` was considered. It was rejected because:

1. It creates artificial coupling between identity and authorization concerns
2. It doesn't carry additional semantic weight beyond what two booleans express
3. It's harder to extend (adding `tenant_org_claim` behavior would require more enum values)

## The Three Fields

```
auto_provision_accounts (bool) -- identity concern
auto_grant_on_org (bool)       -- authorization concern
auto_grant_role (IamRole)      -- role selection (when auto_grant_on_org = true)
```

Each field controls a single, well-defined behavior. The dependency between them (`auto_grant_on_org` requires `auto_provision_accounts`) is a validation rule, not a modeling problem.

## Why on IdentityProvider?

- The IdP is the trust boundary between the external platform and Stigmer
- The IdP owner (platform admin) is the decision-maker for these policies
- Precedent: `is_sso_provider` already lives on IdP spec
- Per-IdP granularity: different IdPs could have different provisioning policies
