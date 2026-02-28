# Workflow API Resource Reference

Schema reference for the `agentic.stigmer.ai/v1` Workflow resource. For conceptual overview and lifecycle, see [README.md](README.md).

## Workflow Resource Shape

A Workflow resource as returned by `stigmer get workflow <ref> --output yaml`:

```yaml
api_version: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  id: wfl_01abc123def456789
  name: deploy-service
  slug: deploy-service
  org: acme-corp
  visibility: visibility_private
spec:
  description: "Deploys a microservice: build, test, push image, update k8s deployment"
  document:
    dsl: "1.0.0"
    namespace: acme
    name: deploy-service
    version: "1.0.0"
    description: "Microservice deployment pipeline"
  tasks:
    - name: buildImage
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://ci.acme.com/builds"
        body:
          repo: "${.env.REPO_URL}"
          ref: "${.env.GIT_REF}"
      export:
        as: "${.}"
      flow:
        then: pushImage
    - name: pushImage
      kind: http_call
      task_config:
        method: POST
        endpoint:
          uri: "https://registry.acme.com/images"
        body:
          build_id: "${$context.buildImage.id}"
      flow:
        then: deployK8s
    - name: deployK8s
      kind: agent_call
      task_config:
        agent: "k8s-deployer"
        message: "Deploy build ${$context.buildImage.id} to production"
        env:
          KUBECONFIG: "${.secrets.KUBECONFIG}"
  env_spec:
    variables:
      - name: REPO_URL
        required: true
      - name: GIT_REF
        required: true
        default: "main"
status:
  default_instance_id: "wfi_01xyz789"
  serverless_workflow_validation:
    state: VALID
    yaml: |
      document:
        dsl: "1.0.0"
        namespace: acme
        name: deploy-service
        version: "1.0.0"
      do:
        - buildImage:
            call: http
            with: ...
    errors: []
    warnings:
      - "Task 'buildImage' has no error handling"
    validated_at: "2026-01-15T10:35:00Z"
    validation_workflow_id: "validate-workflow-wfl_01abc123"
  audit:
    spec_audit:
      created_by: "usr_xyz"
      created_at: "2026-01-15T10:30:00Z"
      updated_at: "2026-01-15T10:30:00Z"
```

## Top-Level Fields

| Field | Set By | Value |
|---|---|---|
| `api_version` | Author | Always `agentic.stigmer.ai/v1` |
| `kind` | Author | Always `Workflow` |
| `metadata` | Author + system | See below |
| `spec` | Author | See below |
| `status` | System-managed | See below |

## Metadata Fields

All metadata fields are defined by `ApiResourceMetadata` in `ai/stigmer/commons/apiresource/metadata.proto`.

| Field | Description |
|---|---|
| `metadata.id` | System-generated unique identifier. Format: `wfl_<ulid>`. Set by the platform on create; ignored if included in author YAML. |
| `metadata.name` | Canonical display name. Set by the author. Used in the UI and CLI listings. |
| `metadata.slug` | URL-friendly identifier, unique within the organization. Derived from `metadata.name` if not explicitly set. Reference format: `org/slug` (e.g., `acme-corp/deploy-service`). |
| `metadata.org` | Organization that owns this workflow. Provided via `--org` flag or CLI context. Every workflow belongs to exactly one organization. |
| `metadata.visibility` | Access control. `visibility_private` (default): only org members can access. `visibility_public`: anyone can read and reference. |
| `metadata.labels` | Key-value pairs for organization and filtering. |
| `metadata.tags` | String array for categorization and marketplace discoverability. |

### Visibility

```yaml
# Private workflow (default) — only your org can reference and execute it
metadata:
  visibility: visibility_private

# Public workflow — visible to and referenceable by everyone
metadata:
  visibility: visibility_public
```

## Spec Fields

`WorkflowSpec` is defined in `ai/stigmer/agentic/workflow/v1/spec.proto`.

| Field | Required | Description |
|---|---|---|
| `spec.description` | No | Human-readable summary for UI and marketplace display. |
| `spec.document` | Yes | Workflow DSL metadata block. See [Document Fields](#document-fields) below. |
| `spec.tasks` | Yes (≥1) | Ordered list of workflow tasks. See [task-reference.md](task-reference.md) for all task types. |
| `spec.env_spec` | No | Environment variables declared for use in task configs. |

### Document Fields

`WorkflowDocument` maps to the `document:` block in the Serverless Workflow DSL.

| Field | Required | Validation | Description |
|---|---|---|---|
| `document.dsl` | Yes | Must be `"1.0.0"` | DSL version. Must match current Zigflow DSL version. |
| `document.namespace` | Yes | Non-empty | Workflow namespace for organization/categorization. |
| `document.name` | Yes | Non-empty | Workflow name, unique within namespace. |
| `document.version` | Yes | Non-empty | Workflow version (semver recommended, e.g., `"1.0.0"`). |
| `document.description` | No | — | Human-readable description embedded in the generated DSL YAML. |

```yaml
spec:
  document:
    dsl: "1.0.0"
    namespace: acme
    name: deploy-service
    version: "1.0.0"
    description: "Deploys a microservice to production"
```

### Task Fields

Each entry in `spec.tasks` is a `WorkflowTask`:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Task identifier, unique within the workflow. Used in `flow.then` references. |
| `kind` | Yes | Task type. One of the 13 `WorkflowTaskKind` values. |
| `task_config` | Yes | Task-specific configuration. Structure depends on `kind`. See [task-reference.md](task-reference.md). |
| `export` | No | How to save task output to workflow context for subsequent tasks. |
| `flow` | No | Which task executes next. Defaults to sequential execution. |

### Export

`export.as` is a JQ expression defining how the task output is stored in `$context`.

```yaml
export:
  as: "${.}"                           # Export entire task output
  # as: "${.body}"                     # Export only the response body
  # as: "${$context + {myTask: .}}"   # Merge into existing context
```

After export, downstream tasks access this data via `${$context.taskName}`.

### Flow Control

`flow.then` directs execution to a named task or terminates the workflow.

```yaml
flow:
  then: nextTaskName    # Jump to a specific task
  # then: "end"        # Terminate the workflow
```

If `flow` is omitted, execution continues to the next task in the `tasks` list. The last task in the list terminates the workflow by default.

### Environment Spec

`env_spec` declares the environment variables the workflow uses. These are resolved at execution time from the Workflow Instance's environment bindings.

```yaml
spec:
  env_spec:
    variables:
      - name: API_BASE_URL
        required: true
      - name: TIMEOUT_SECONDS
        required: false
        default: "30"
```

Declared variables are accessible in task configs via `${.env.VARIABLE_NAME}`.

## Status Fields

`WorkflowStatus` is system-managed. Never set these fields in author YAML.

| Field | Description |
|---|---|
| `status.default_instance_id` | ID of the default Workflow Instance created automatically. Every workflow has exactly one default instance with no environment bindings. |
| `status.serverless_workflow_validation` | Asynchronous DSL validation result. See [Validation State](#validation-state) below. |
| `status.audit` | Standard audit record: `created_by`, `created_at`, `updated_by`, `updated_at`. |

### Validation State

`ServerlessWorkflowValidation` is populated asynchronously after workflow creation by a Temporal validation workflow.

| Field | Description |
|---|---|
| `state` | Current validation state. See [Validation States](#validation-states) below. |
| `yaml` | Generated Serverless Workflow DSL YAML. Present even on validation failure (useful for debugging). Empty until validation starts. |
| `errors` | List of validation error messages. Empty when `state: VALID`. |
| `warnings` | Non-fatal warnings (e.g., unreferenced env vars, tasks without error handling). |
| `validated_at` | Timestamp of last validation. Null until validation completes. |
| `validation_workflow_id` | Temporal workflow ID for the validation run. Format: `validate-workflow-{workflow_id}`. |

### Validation States

| State | Meaning |
|---|---|
| `PENDING` | Validation triggered but not yet complete. Initial state after create or update. |
| `VALID` | Validation passed. Workflow structure is correct and the generated YAML is stored. |
| `INVALID` | Validation found structural errors. Check `errors` field. Fix the spec and re-apply. |
| `FAILED` | Validation system error (Temporal crash, timeout). Not a user error. Re-apply to retry. |

State transitions:

```
PENDING ──► VALID
   │
   ├───────► INVALID
   │
   └───────► FAILED (retry by re-applying)
```

**Important**: A workflow in `INVALID` state cannot be executed. Always check `status.serverless_workflow_validation.state` before creating Workflow Instances.

## CLI Commands

All workflow operations use `stigmer <verb> workflow` — not `stigmer workflow <verb>`.

```bash
# Apply a workflow (create or update)
stigmer apply workflow.yaml

# Apply from a specific file path
stigmer apply ./workflows/deploy-service.yaml

# Apply to a specific organization
stigmer apply workflow.yaml --org acme-corp

# Preview what would be applied without making changes
stigmer apply workflow.yaml --dry-run

# Get a workflow by slug, org/slug, or resource ID
stigmer get workflow deploy-service
stigmer get workflow acme-corp/deploy-service
stigmer get workflow wfl_01abc123

# Get as YAML or JSON
stigmer get workflow deploy-service --output yaml
stigmer get workflow deploy-service --output json

# Check validation status
stigmer get workflow deploy-service --output yaml | grep -A 5 serverless_workflow_validation

# List all workflows in the current org
stigmer list workflows

# List with a limit
stigmer list workflows --limit 20

# List from a specific org
stigmer list workflows --org acme-corp

# Delete a workflow
stigmer delete workflow deploy-service
stigmer delete workflow deploy-service --force  # skip confirmation
```

### Apply Flags Reference

| Flag | Default | Description |
|---|---|---|
| `--org <org>` | CLI context | Organization to apply into. |
| `--dry-run` | `false` | Validate the YAML and preview changes without applying. |
| `--force` | `false` | Skip confirmation prompts for destructive operations. |

## Related Documentation

- [README.md](README.md) — Overview, lifecycle, and table of contents
- [task-reference.md](task-reference.md) — All 13 task types with full schemas and examples
- [expressions.md](expressions.md) — JQ expression syntax for dynamic values in task configs
- [examples.md](examples.md) — Complete end-to-end workflow YAML examples
