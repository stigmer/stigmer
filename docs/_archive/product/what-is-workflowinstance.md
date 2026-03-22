# What is a Workflow Instance?

## One-Sentence Positioning

**A WorkflowInstance is a configured deployment of a Workflow template—the same way a GitHub Actions run configuration binds a workflow file to its secrets, environment, and target repository.**

---

## Executive Summary

A WorkflowInstance is the layer between the Workflow blueprint and live execution. The Workflow declares *what* it needs—which environment variables, which credentials—without providing the actual values. The WorkflowInstance supplies those values by binding one or more Environment resources to the Workflow template.

WorkflowInstance sits at the second layer of the two-layer Workflow stack:

```
Workflow ──► WorkflowInstance
```

When a WorkflowExecution is triggered, it runs against a specific WorkflowInstance, which determines which environment configuration and secrets the execution receives.

Every Workflow gets a **default instance** created automatically at creation time. The default instance has no environment bindings and lets you run the workflow immediately—no configuration required. Named instances exist for when you need to supply credentials and environment-specific values: a production database URL, a staging API key, a per-team OAuth secret.

The separation is the point: the same Workflow YAML runs in development and production without modification. You create one WorkflowInstance per environment, each pointing at a different set of credentials. The blueprint never changes. Only the binding does.

---

## The Problem WorkflowInstance Solves

### Credentials Belong to Deployments, Not Blueprints

A typical hardcoded automation approach mixes environment-specific values with pipeline logic:

```python
def deploy_service(build_id):
    # Credentials and endpoint URLs embedded directly in the script
    DEPLOY_API_URL = "https://deploy.acme.com"
    APPROVER_EMAIL = "platform-team@acme.com"
    AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY")

    result = requests.post(f"{DEPLOY_API_URL}/deployments", json={
        "build_id": build_id,
        "access_key": AWS_ACCESS_KEY,
    })
    send_approval_email(APPROVER_EMAIL, build_id)
```

This works until you need to run the same pipeline against staging instead of production, or hand it to another team who has their own credentials.

**What goes wrong:**

- Running the same pipeline against staging vs. production requires duplicating the script with different hardcoded values, or adding environment-selection logic that bloats the pipeline definition.
- Rotating a credential—a compromised API key, an expired token—means finding every place it is referenced and updating application code.
- Per-team deployments—where each team's pipeline run uses their own cloud account—have no clean model. The credential either lives in the pipeline definition (wrong), or in a tangle of environment variable overrides nobody fully understands.
- A team can share a Workflow definition, but the consumer cannot bring their own credentials without forking and modifying the workflow.
- There is no record of which credentials were active when a specific execution ran.

### WorkflowInstance as the Answer

WorkflowInstance separates the *what* (Workflow spec) from the *where and with what credentials* (environment bindings):

- The Workflow spec declares `DEPLOY_API_URL`, `APPROVER_EMAIL`, and `AWS_ACCESS_KEY` as required env vars. No values are stored in the Workflow.
- A WorkflowInstance named `deploy-service-prod` references an Environment resource that holds the actual production values.
- A second WorkflowInstance named `deploy-service-staging` references a different Environment with staging values.
- Both instances run the same Workflow. Rotating the production credential means updating the Environment resource—the Workflow and WorkflowInstance YAMLs change nothing.

---

## The WorkflowInstance Resource

WorkflowInstance follows the standard Stigmer resource pattern: a `spec` for what you configure, and a `status` for what the system manages.

### The Spec: What You Configure

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: deploy-service-prod
  org: acme-corp
  labels:
    env: production
    team: platform
spec:
  # The Workflow template this instance deploys.
  workflow_id: wfl_01abc123def456789

  # Human-readable description to distinguish this instance from others.
  description: "Production deployment instance — targets AWS us-east-1, requires security team approval"

  # One or more Environment resources to bind to this instance.
  # Merged in order — later environments override earlier ones for shared keys.
  env_refs:
    - slug: base-config
    - slug: aws-prod-env
    - slug: github-deploy-token
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `workflow_id` | Yes | The Workflow template to deploy. Immutable after creation — delete and recreate to change. |
| `description` | No | Human-readable label for this instance. Shown in the UI and `list` output to distinguish multiple instances of the same workflow. |
| `env_refs` | No | Ordered list of Environment resources to bind. Merged left-to-right; later entries override earlier ones for any shared key. |

### The Status: What the System Manages

The WorkflowInstance status is an audit record. You never set it—it is maintained by the system.

```yaml
status:
  audit:
    created_by: usr_abc123
    created_at: "2026-01-15T10:30:00Z"
    updated_by: usr_abc123
    updated_at: "2026-01-20T14:00:00Z"
    version: 3
```

There is no workflow-state field on the instance—execution state belongs to WorkflowExecution resources, not to the instance configuration. The instance is static configuration; executions are the runtime records.

---

## Environment Binding

The core of WorkflowInstance is the merge of one or more Environment resources into a unified set of key-value pairs that the workflow receives at execution time.

### How Environments Are Merged

Environments are merged **left to right** — later entries override earlier ones for any shared key:

```
Workflow env_spec defaults  <  env_refs[0]  <  env_refs[1]  <  env_refs[2]  <  ...
```

**Example:**

| Source | `TIMEOUT` | `DEPLOY_API_URL` | `AWS_REGION` |
|---|---|---|---|
| Workflow `env_spec` default | `"30"` | *(not declared)* | *(not declared)* |
| `base-config` (index 0) | `"60"` | `https://deploy.acme.com` | *(not set)* |
| `aws-prod-env` (index 1) | *(not set)* | *(not set)* | `us-east-1` |

**Result at execution time:** `TIMEOUT = "60"`, `DEPLOY_API_URL = "https://deploy.acme.com"`, `AWS_REGION = "us-east-1"`.

If a required environment variable (declared with `required: true` in `spec.env_spec`) has no value after merging all environments, the WorkflowExecution fails immediately at startup with a clear error before any tasks run.

### Layered Configuration Pattern

This merge order unlocks a clean layering pattern. A common enterprise setup uses three layers:

```yaml
env_refs:
  - slug: base-config          # Non-secret defaults shared across all instances
  - slug: aws-prod-env         # Cloud credentials for this specific environment
  - slug: github-deploy-token  # Team-specific or scope-limited tokens
```

Switch from staging to production by changing only the second and third entries. The base config layer remains untouched. The Workflow definition is never modified.

---

## The Default Instance

Every Workflow automatically gets a default WorkflowInstance at creation time. This instance has no `env_refs` and is intended for immediate use without configuration — useful for stateless workflows or for quick local testing.

The default instance ID is recorded in the Workflow resource at `status.default_instance_id`.

```bash
# Run using the default instance (no env bindings)
stigmer run workflow my-workflow

# Run using a specific named instance
stigmer run workflow my-workflow --instance deploy-service-prod
```

For production use, always create a named instance with explicit environment bindings. Do not rely on the default instance for workflows with required environment variables.

---

## Multiple Instances Per Workflow

There is no limit to how many instances a single Workflow can have. Common patterns:

**Environment promotion:**

```
deploy-service-dev      → [dev-config]
deploy-service-staging  → [base-config, aws-staging-env]
deploy-service-prod     → [base-config, aws-prod-env, github-deploy-token]
```

**Per-team deployments:**

```
data-pipeline-platform-team → [base-config, platform-team-env]
data-pipeline-infra-team    → [base-config, infra-team-env]
```

**Per-region deployments:**

```
deploy-service-us-east → [base-config, aws-us-east-prod]
deploy-service-eu-west → [base-config, aws-eu-west-prod]
```

In all cases, the Workflow YAML is authored once and never changes.

---

## Before Running: Confirm Workflow Validity

A WorkflowInstance references a Workflow template. Before executing, the referenced Workflow must have passed asynchronous validation — its `status.serverless_workflow_validation.state` must be `VALID`.

```bash
# Confirm the workflow is valid before creating or running an instance
stigmer get workflow deploy-service --output yaml | grep -A 3 "serverless_workflow_validation"
# state: VALID

# A workflow in INVALID state cannot be executed — the execution will fail immediately
# state: INVALID
# errors:
#   - "Task 'notifyRejected' references flow.then 'missingTask' which does not exist"
```

Creating a WorkflowInstance against an `INVALID` or `PENDING` workflow succeeds (the instance is just configuration), but any WorkflowExecution triggered from it will fail until the workflow reaches `VALID` state.

---

## Getting Started

```bash
# 1. Apply a workflow (if not already done)
stigmer apply my-workflow.yaml

# 2. Confirm the workflow is valid
stigmer get workflow my-workflow --output yaml | grep "state:"
# state: VALID

# 3. Run with the default instance — no configuration needed
stigmer run workflow my-workflow

# 4. Write an instance YAML with environment bindings
cat > my-instance.yaml << 'EOF'
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: my-workflow-prod
  org: acme-corp
spec:
  workflow_id: wfl_01abc123def456789
  description: "Production instance for my-workflow"
  env_refs:
    - slug: prod-env
EOF

# 5. Apply the instance
stigmer apply my-instance.yaml

# 6. Run using the named instance
stigmer run workflow my-workflow --instance my-workflow-prod

# 7. List all instances
stigmer list workflow-instances

# 8. Inspect an instance
stigmer get workflow-instance my-workflow-prod --output yaml

# 9. Update (re-apply with changed env_refs)
stigmer apply my-instance.yaml

# 10. Delete an instance no longer needed
stigmer delete workflow-instance my-workflow-prod
```

---

## How It Compares

| Without WorkflowInstance | With WorkflowInstance |
|---|---|
| Environment values hardcoded into pipeline scripts or workflow definitions | Secrets and config live in Environment resources; Workflow YAML has none |
| Staging and production require duplicate workflow definitions or complex branching | One Workflow, separate instances for each environment |
| Rotating a credential means finding every reference in code | Update the Environment resource; all instances pick it up on the next execution |
| No record of which credentials were active when a specific execution ran | Instance binding is captured at execution time — clear, auditable configuration |
| Sharing a workflow requires sharing its credentials | Credentials stay in the instance; the Workflow template is credential-free |
| Per-team pipelines require per-team workflow forks | One Workflow, separate instances with team-specific environment refs |

---

## Further Reading

- [What is a Workflow?](./what-is-workflow.md) — The blueprint that WorkflowInstance deploys
- [WorkflowInstance Resource Guide](../../apis/ai/stigmer/agentic/workflowinstance/docs/workflowinstance-resource-guide.md) — Complete spec and status schema reference
- [WorkflowInstance Examples](../../apis/ai/stigmer/agentic/workflowinstance/docs/examples.md) — Complete YAML examples from minimal to multi-environment
- [Workflow Resource Guide](../../apis/ai/stigmer/agentic/workflow/docs/workflow-resource-guide.md) — Workflow template field reference, env_spec declaration, and validation lifecycle
- [What is an Agent Instance?](./what-is-agent-instance.md) — The parallel pattern for the Agent→AgentInstance stack
