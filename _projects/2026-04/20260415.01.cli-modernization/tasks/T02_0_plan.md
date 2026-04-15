# Task T02: Close All Apply Gaps (6 New Resource Kinds)

**Created**: 2026-04-15
**Status**: PENDING (depends on T01)
**Type**: Feature Development

## Objective

Implement `ApplyHandler` for every resource kind that has an Apply RPC but is missing from the CLI. This closes Issue #122 (IdentityProvider) and 5 other gaps simultaneously.

## Missing Resources (6 kinds)

| Kind | apiVersion | Key RPCs | Notes |
|------|-----------|----------|-------|
| **IdentityProvider** | `iam.stigmer.ai/v1` | apply, get, getByReference, listByOrg, delete | Issue #122. JWKS, issuers, audience, SSO config. |
| **OAuthApp** | `iam.stigmer.ai/v1` | apply, get, getByReference, listByOrg, delete | Vendor OAuth app definitions for MCP servers. |
| **Environment** | `agentic.stigmer.ai/v1` | apply, get, getByReference, list, delete, updateVariables | Variable/secret management. |
| **AgentInstance** | `agentic.stigmer.ai/v1` | apply, get, getByAgent, getByReference, list, delete | Deployed agent instances. |
| **WorkflowInstance** | `agentic.stigmer.ai/v1` | apply, get, getByWorkflow, getByReference, list, delete | Deployed workflow instances. |
| **Session** | `agentic.stigmer.ai/v1` | apply, get, list, listByAgent, delete | Agent conversation sessions. |

## Task Breakdown (per resource — repeat for all 6)

### For each resource kind:

1. **Register in CLI type system**
   - Add to `cliRelevantKinds` in `internal/cli/types/registry.go`
   - Add verb support in `internal/cli/types/verb_support.go`

2. **Create domain package** (`internal/cli/<resource>/`)
   - `handler.go` — implements `ApplyHandler` interface
   - `loader.go` — YAML -> proto unmarshaling (YAML -> map -> JSON -> protojson)
   - `get.go` — `GetFromBackend` with `reference.Parse` for get/delete
   - `display.go` — dry-run and success display helpers

3. **Register handler** in the `ApplyHandler` registry from T01

4. **Add `draft` scaffold** (where appropriate)
   - `cmd/stigmer/root/draft_<resource>.go` — YAML template generation

5. **Tests**
   - Loader tests (valid YAML, invalid YAML, edge cases)
   - Handler tests (nil checks, dry-run, org resolution)
   - Registry test assertions (CI guard should now pass for this kind)

### Implementation order

1. IdentityProvider (Issue #122 — highest priority, community request)
2. Environment (frequently used, high user value)
3. AgentInstance (pairs naturally with Agent)
4. WorkflowInstance (pairs naturally with Workflow)
5. OAuthApp (IAM resource, pairs with IdentityProvider)
6. Session (less common for declarative management)

## YAML Contracts

```yaml
# IdentityProvider
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: my-auth0
  org: my-org
spec:
  display_name: "My Auth0 Provider"
  jwks_uri: "https://my-tenant.auth0.com/.well-known/jwks.json"
  allowed_issuers: ["https://my-tenant.auth0.com/"]
  expected_audience: "https://api.my-app.com/"
---
# OAuthApp
apiVersion: iam.stigmer.ai/v1
kind: OAuthApp
metadata:
  name: my-github-oauth
  org: my-org
spec:
  display_name: "GitHub OAuth"
  vendor: github
---
# Environment
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: prod-env
  org: my-org
spec:
  variables:
    - key: DATABASE_URL
      value: "postgres://..."
    - key: API_SECRET
      is_secret: true
---
# AgentInstance
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: my-assistant
  org: my-org
spec:
  agent_id: agt-abc123
---
# WorkflowInstance
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: deploy-pipeline
  org: my-org
spec:
  workflow_id: wfl-xyz789
---
# Session
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: debug-session
  org: my-org
spec:
  agent_instance_id: ain-abc123
```

## Success Criteria

- [ ] All 6 handlers implemented and registered
- [ ] CI guard test `TestAllApplyableKindsAreRegistered` passes with zero exclusions (except execution_context)
- [ ] `stigmer apply -f identity-provider.yaml` works end-to-end (Issue #122)
- [ ] `stigmer apply -f` works for all 6 new kinds
- [ ] `stigmer get/list/delete` works for all 6 new kinds
- [ ] `draft` scaffolds exist for IdentityProvider, Environment, AgentInstance, WorkflowInstance
- [ ] All tests pass: `go test ./...`

## Next Task Preview

**T03: Replace `discover` with `connect`, slug audit, MCP OAuth flow**
