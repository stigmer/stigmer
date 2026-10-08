# ExecutionContext Examples

Example ExecutionContext payloads and runner lookup patterns. All YAML reflects actual field names.

> **Note**: ExecutionContexts are created and deleted by the Stigmer execution engine, not by end users. These examples illustrate the payloads the engine produces and the patterns runners use to consume them.

---

## Minimal — Single Non-Secret Value

The simplest ExecutionContext, carrying one non-secret configuration value for a single run.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-abc123
  org: acme-corp
spec:
  execution_id: "run_abc123"
  data:
    LOG_LEVEL:
      value: "info"
      is_secret: false
```

---

## Single Secret Value

An ExecutionContext carrying one secret credential. The value is encrypted at rest and redacted in all API responses except the runner's `getByExecutionId` call.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-def456
  org: acme-corp
spec:
  execution_id: "run_def456"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
```

---

## Mixed — Secrets and Plain Config

ExecutionContexts routinely carry both secret credentials and non-secret configuration. Each key is independently marked.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-ghi789
  org: acme-corp
spec:
  execution_id: "run_ghi789"
  data:
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
    AWS_SECRET_ACCESS_KEY:
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      is_secret: true
    LOG_LEVEL:
      value: "info"
      is_secret: false
```

---

## B2B Runtime Injection — Planton Integration

In B2B scenarios, a calling platform (e.g., Planton) hands the conversation its own values (the session's `secrets` and `connections`) rather than saving them in a vault. The execution engine fills the ExecutionContext from them and deletes it on completion.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-jkl012
  org: planton
spec:
  execution_id: "run_jkl012"
  data:
    PLANTON_API_TOKEN:
      value: "plt_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    PLANTON_ORG_ID:
      value: "org_acme"
      is_secret: false
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    GITHUB_REPO:
      value: "acme-corp/infra"
      is_secret: false
    TERRAFORM_STATE_BUCKET:
      value: "acme-tf-state-prod"
      is_secret: false
    TERRAFORM_CLOUD_TOKEN:
      value: "tfc_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
```

---

## Filled From Several Vaults

When the schedule or PlatformClient that started a run names several vaults, the execution engine fills each key the run declares from the first vault holding it, in the order they are named, and creates a single ExecutionContext. This example shows the result — the runner sees one flat map, not the vaults.

Given, in this order:
- Vault `aws-prod`: `AWS_REGION=us-east-1`, `AWS_ACCESS_KEY_ID=...`, `AWS_SECRET_ACCESS_KEY=...`
- Vault `github-prod`: `GITHUB_TOKEN=ghp_prod_...`
- Vault `global-defaults`: `LOG_LEVEL=info`, `AWS_REGION=us-west-2` (its `AWS_REGION` is not used: `aws-prod` holds the key first)

Merged ExecutionContext produced by the engine:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-mno345
  org: acme-corp
spec:
  execution_id: "run_mno345"
  data:
    LOG_LEVEL:
      value: "info"
      is_secret: false
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
    GITHUB_TOKEN:
      value: "ghp_prod_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
    AWS_SECRET_ACCESS_KEY:
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      is_secret: true
```

---

## Runner Lookup Pattern

Runners retrieve the ExecutionContext for their run using `getByExecutionId`. This is the only operation that can return **decrypted** secret values — and on cloud it does so only when the caller presents a platform-minted runner credential whose scope claim binds it to this run (`token_type` of `sandbox` or `connect_sandbox`). The unscoped `embedded_runner` bootstrap credential is refused; desktop runners exchange it for a scoped token via `getRunnerScopedToken` before reading. User-class callers receive redacted values, same as `get`.

```
# Pseudo-code: what the agent runner does at startup

executionId = getenv("STIGMER_EXECUTION_ID")  # injected by the runner harness

ctx = ExecutionContextQueryController.getByExecutionId({
  execution_id: executionId
})

# Inject all values into the agent sandbox environment
for key, execValue in ctx.spec.data:
    os.environ[key] = execValue.value  # decrypted by the server before returning
```

All other query paths (`get`, `getByReference`) redact secret values and are used for audit or debug purposes, not for runtime run.

---

## Full-Featured — Labels, Annotations, Tags

ExecutionContexts support the same metadata decoration as all Stigmer resources, useful for audit trail filtering and tracing.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: ExecutionContext
metadata:
  name: exec-ctx-aex-stu901
  org: acme-corp
  labels:
    execution-type: agent
    environment: production
    team: platform
  annotations:
    agent: "agt_abc123"
    triggered-by: "schedule-sch_xyz"
  tags:
    - production
    - agent-run
    - platform-team
spec:
  execution_id: "run_stu901"
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
    AWS_REGION:
      value: "us-east-1"
      is_secret: false
    AWS_ACCESS_KEY_ID:
      value: "AKIAIOSFODNN7EXAMPLE"
      is_secret: true
    AWS_SECRET_ACCESS_KEY:
      value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
      is_secret: true
    LOG_LEVEL:
      value: "info"
      is_secret: false
```
