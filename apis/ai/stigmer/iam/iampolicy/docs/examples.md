# IamPolicy Examples

Complete examples for granting access, revoking access, and querying authorization.

## Grant a User Viewer Access to an Organization

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-demo-org-viewer
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQUSER123
  resource:
    kind: organization
    id: org-01HQDEMO456
  relation: viewer
```

## Grant a User Admin Access to an Agent

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-deploy-agent-admin
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQALICE
  resource:
    kind: agent
    id: agt-01HQDEPLOY
  relation: admin
```

## Let a Team Use a Shared Vault

Using the `principal.relation` qualifier to target all members of a team. The `user` relation is the console's **Can use** role: the team's runs may read the vault's secrets and logins, but nobody on the team can see a value or change the vault.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: support-team-tools-user
  org: acme-corp
spec:
  principal:
    kind: team
    id: tm-01HQSUPPORT
    relation: member  # all members of this team
  resource:
    kind: vault
    id: vlt-01HQSUPPORTTOOLS
  relation: user
```

## Revoke Access

Revoking access uses the same spec as granting. The policy is identified by the combination of principal, resource, and relation.

```yaml
# revoke-alice-viewer.yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: alice-demo-org-viewer
  org: acme-corp
spec:
  principal:
    kind: identity_account
    id: ia-01HQUSER123
  resource:
    kind: organization
    id: org-01HQDEMO456
  relation: viewer
```

```bash
stigmer iam-policy delete revoke-alice-viewer.yaml
```

## CLI: Check Authorization

```bash
# Does Alice have viewer access on the Demo organization?
stigmer iam-policy check-authorization \
  --principal-kind identity_account \
  --principal-id ia-01HQUSER123 \
  --resource-kind organization \
  --resource-id org-01HQDEMO456 \
  --relation viewer

# Output:
# is_authorized: true
```

## CLI: List Resources a Principal Can Access

```bash
# Which organizations can Alice view?
stigmer iam-policy list-authorized-resources \
  --principal-kind identity_account \
  --principal-id ia-01HQUSER123 \
  --resource-kind organization \
  --relation viewer

# Output:
# resource_ids:
#   - org-01HQDEMO456
#   - org-01HQSTAGING789
```

## CLI: List Principals With Access to a Resource

```bash
# Who may use the Support tools vault?
stigmer iam-policy list-authorized-principals \
  --resource-kind vault \
  --resource-id vlt-01HQSUPPORTTOOLS \
  --principal-kind identity_account \
  --relation user

# Output:
# principal_ids:
#   - ia-01HQALICE
#   - ia-01HQBOB
```

## Grant a Machine Account Operator Access (Platform Operations)

This is an operator-only operation performed by platform services, not end users.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: platform-link-alice
  org: stigmer
spec:
  principal:
    kind: platform
    id: stigmer
  resource:
    kind: identity_account
    id: ia-01HQALICE
  relation: platform
```
