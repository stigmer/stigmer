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

## Grant Team Members Editor Access to an Environment

Using the `principal.relation` qualifier to target all members of a team.

```yaml
apiVersion: iam.stigmer.ai/v1
kind: IamPolicy
metadata:
  name: eng-team-staging-editor
  org: acme-corp
spec:
  principal:
    kind: team
    id: tm-01HQENGTEAM
    relation: member  # all members of this team
  resource:
    kind: environment
    id: env-01HQSTAGING
  relation: editor
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
# Who has editor access on the staging environment?
stigmer iam-policy list-authorized-principals \
  --resource-kind environment \
  --resource-id env-01HQSTAGING \
  --principal-kind identity_account \
  --relation editor

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
