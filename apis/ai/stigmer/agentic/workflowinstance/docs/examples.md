# WorkflowInstance Examples

Complete, working workflow instance YAML examples from minimal single-environment setups to layered multi-environment configurations. All examples can be applied directly with `stigmer apply`.

---

## Minimal Instance (No Environment Bindings)

The simplest possible workflow instance — references a workflow with no environment bindings. Suitable for stateless workflows that make no external calls requiring credentials, or for quick local testing using a workflow with optional-only env vars.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: hello-world-instance
  org: default
spec:
  workflow_id: wfl_01abc123def456789
  description: "Default instance for the hello-world workflow"
```

**Apply:**
```bash
stigmer apply workflow-instance.yaml
```

---

## Single Environment

Bind one environment to a workflow. This is the most common pattern for dev/staging deployments where a single environment contains all needed credentials.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: deploy-service-staging
  org: acme-corp
spec:
  workflow_id: wfl_01xyz789abc
  description: "Staging deployment of deploy-service workflow — targets AWS us-west-2"
  env_refs:
    - slug: aws-staging-env
```

The `aws-staging-env` environment must be an existing Environment resource in the same org and must contain all the variables the referenced workflow's `spec.env_spec` declares as `required: true`.

---

## Multi-Environment Layering

Layer multiple environments to compose configuration from reusable building blocks. Later environments override earlier ones when keys conflict.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: deploy-service-prod
  org: acme-corp
spec:
  workflow_id: wfl_01xyz789abc
  description: "Production deployment — base config + AWS prod credentials + GitHub main token"
  env_refs:
    - slug: base-config         # Common timeouts, feature flags, service URLs
    - slug: aws-prod-env        # AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    - slug: github-main-token   # GITHUB_TOKEN scoped to the main branch
```

**Resolved configuration** (what the workflow sees at execution time):

```
base-config:         TIMEOUT=30, LOG_LEVEL=info, API_URL=https://api.acme.com
aws-prod-env:        AWS_REGION=us-east-1, AWS_ACCESS_KEY_ID=..., TIMEOUT=60
github-main-token:   GITHUB_TOKEN=ghp_...

Final resolved:      TIMEOUT=60            ← aws-prod-env overrides base-config
                     LOG_LEVEL=info        ← base-config (no conflict)
                     API_URL=https://...   ← base-config (no conflict)
                     AWS_REGION=us-east-1  ← aws-prod-env only
                     AWS_ACCESS_KEY_ID=... ← aws-prod-env only
                     GITHUB_TOKEN=ghp_...  ← github-main-token only
```

---

## Three Instances of One Workflow

A single Workflow template serving dev, staging, and production via three separate instances. Each instance is identical in structure; only the environment bindings differ.

```yaml
# dev-instance.yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: data-pipeline-dev
  org: acme-corp
spec:
  workflow_id: wfl_01datapipeline
  description: "Data pipeline — development environment, uses mock data sources"
  env_refs:
    - slug: base-config
    - slug: aws-dev-env
```

```yaml
# staging-instance.yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: data-pipeline-staging
  org: acme-corp
spec:
  workflow_id: wfl_01datapipeline
  description: "Data pipeline — staging environment, mirrors production data sources"
  env_refs:
    - slug: base-config
    - slug: aws-staging-env
```

```yaml
# prod-instance.yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: data-pipeline-prod
  org: acme-corp
spec:
  workflow_id: wfl_01datapipeline
  description: "Data pipeline — production, runs nightly at 02:00 UTC via WorkflowExecution cron"
  env_refs:
    - slug: base-config
    - slug: aws-prod-env
    - slug: datadog-prod-metrics
```

Apply all three:
```bash
stigmer apply dev-instance.yaml
stigmer apply staging-instance.yaml
stigmer apply prod-instance.yaml
```

---

## Cross-Org Workflow Reference

Reference a public workflow from another organization. The workflow must have `metadata.visibility: visibility_public`.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: security-scan-instance
  org: acme-corp
spec:
  workflow_id: wfl_01stigmersecurityscan  # public workflow from stigmer org
  description: "Runs the shared stigmer security scan workflow against our repos"
  env_refs:
    - slug: github-acme-token
    - slug: security-api-creds
```

---

## Iterative Development Workflow

Typical development cycle for a new workflow instance:

```bash
# 1. Confirm your workflow is valid before creating an instance
stigmer get workflow my-workflow --output yaml | grep -A 3 "serverless_workflow_validation"
# state: VALID

# 2. Write the instance YAML
cat > my-instance.yaml << 'EOF'
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: my-workflow-dev
  org: default
spec:
  workflow_id: wfl_01abc123def456789
  description: "Development instance for my-workflow"
  env_refs:
    - slug: dev-env
EOF

# 3. Preview without applying
stigmer apply my-instance.yaml --dry-run

# 4. Apply to the platform
stigmer apply my-instance.yaml

# 5. Verify creation
stigmer get workflow-instance my-workflow-dev --output yaml

# 6. Add a second environment (update in place)
# Edit my-instance.yaml to add a second env_ref, then re-apply:
stigmer apply my-instance.yaml

# 7. Confirm the version incremented
stigmer get workflow-instance my-workflow-dev --output yaml | grep version
# version: 2
```

---

## Labeling and Tagging Instances

Use labels and tags to organize instances across large organizations.

```yaml
api_version: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: order-processor-prod
  org: acme-corp
  labels:
    team: platform
    service: order-processing
    tier: production
    region: us-east-1
  tags:
    - critical
    - billing
    - pci-compliant
spec:
  workflow_id: wfl_01orderprocessor
  description: "Production order processor for the US East region — PCI compliant"
  env_refs:
    - slug: pci-base-config
    - slug: stripe-prod-creds
    - slug: aws-prod-us-east
```

Labels and tags have no effect on execution — they are purely for discoverability, filtering, and tooling integration.
