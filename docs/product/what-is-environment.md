# What is an Environment?

## One-Sentence Positioning

**An Environment is a named, encrypted key-value store for secrets and configuration—the same way a `.env` file holds your app's credentials, but versioned, access-controlled, and reusable across any number of agents.**

---

## Executive Summary

An Environment is Stigmer's foundational secret-management resource. It stores the credentials, API tokens, and configuration that agents need at runtime — separated completely from the Agent definition that declares them.

The Agent spec declares *which* variables it needs. The Environment holds the *actual values*. An AgentInstance binds the two together.

```
Environment ──► AgentInstance ──► AgentExecution
```

Each key-value pair in an Environment is individually marked as secret or non-secret:

- **Secret values** (`is_secret: true`) are encrypted at rest, redacted in all logs, and never returned by the API.
- **Non-secret values** (`is_secret: false`) are stored as plaintext and visible in audit output — safe for config like region names, log levels, or feature flags.

A single Environment can be referenced by many AgentInstances simultaneously. Rotating a credential means updating the Environment once — every agent that references it picks up the new value on its next execution, with no changes to any AgentInstance or Agent.

---

## The Problem Environment Solves

### Secrets Don't Belong in Agent Definitions

A natural first instinct is to embed credentials directly in the agent:

```yaml
spec:
  env_spec:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"   # hardcoded — wrong
      is_secret: true
```

Or worse, to inject them via application code at call time with no structure:

```python
execution = stigmer.run(
    agent="my-github-agent",
    env={"GITHUB_TOKEN": os.getenv("GITHUB_TOKEN")},  # scattered — wrong
)
```

**What goes wrong:**

- Credentials are coupled to the agent definition. The same Agent YAML cannot be run against staging and production without duplicating it or adding environment-selection logic.
- Rotating a token means finding every agent and every call site that uses it. There is no single place to update.
- Multiple agents that share the same credentials (e.g., a GitHub token used by a code review agent, a PR agent, and a release agent) have no way to share a single source of truth.
- There is no audit trail: which credential was in use when a specific execution ran six months ago?
- Sharing an agent in the marketplace means shipping it with hardcoded credentials or requiring consumers to fork and modify the agent to add their own.
- Per-customer deployments — where every customer needs the agent to run with their own API key — have no clean model without Environment as a first-class resource.

### Environment as the Answer

Environment separates *where secrets live* from *what agents do with them*:

- The Agent spec declares `GITHUB_TOKEN` is required, with `is_secret: true`. No value is stored.
- An Environment named `github-prod-secrets` holds the actual token, encrypted.
- An AgentInstance named `github-bot-production` references that Environment.
- A second Environment named `github-staging-secrets` holds a different token.
- A second AgentInstance named `github-bot-staging` references that one.

Both instances run the same Agent. Rotating the production token means updating `github-prod-secrets`. Nothing else changes.

---

## The Environment Resource

Environment follows the standard Stigmer resource pattern: a `spec` for what you configure, and a `status` for what the system manages.

### The Spec: What You Configure

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: github-prod-secrets
  org: acme-corp
  labels:
    env: production
    team: platform
spec:
  # Human-readable description of what this environment contains.
  description: "GitHub production credentials for the main monorepo bot"

  # Key-value pairs. Each value is independently marked secret or non-secret.
  data:
    GITHUB_TOKEN:
      value: "ghp_xxxxxxxxxxxxxxxxxxxx"
      is_secret: true
      description: "GitHub token with repo and PR permissions"
    LOG_LEVEL:
      value: "warn"
      is_secret: false
      description: "Log verbosity for production"
    GITHUB_ORG:
      value: "acme-corp"
      is_secret: false
      description: "GitHub organization to operate against"
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `description` | No | Human-readable label for the environment. Shown in the UI and `list` output. |
| `data` | No | Map of key-value pairs. Each key maps to an `EnvironmentValue` with `value`, `is_secret`, and an optional `description`. |

### EnvironmentValue: The Core Unit

Each entry in `data` is an `EnvironmentValue`:

| Field | Description |
|---|---|
| `value` | The actual string value. Encrypted at rest when `is_secret: true`. |
| `is_secret` | When `true`: encrypted at rest, redacted in logs, never returned by the API. When `false`: plaintext, visible in audit output. |
| `description` | Per-value documentation. Makes the environment self-documenting. |

**Choosing between secret and non-secret:**

| Use `is_secret: false` | Use `is_secret: true` |
|---|---|
| Region names (`us-east-1`) | API tokens and keys |
| Log levels (`debug`, `warn`) | Passwords and private keys |
| Feature flags (`true`, `false`) | OAuth secrets and webhook secrets |
| Public URLs and endpoints | Database connection strings |

### The Status: What the System Manages

The Environment status is an audit record. You never set it — it is maintained by the system.

```yaml
status:
  spec_audit:
    created_by: "user_abc123"
    created_at: "2026-02-28T09:00:00Z"
    updated_by: "user_abc123"
    updated_at: "2026-02-28T09:00:00Z"
    event: CREATE
  status_audit:
    created_by: "system"
    created_at: "2026-02-28T09:00:00Z"
```

---

## How Environments Are Used

### Referenced by AgentInstances

An Environment is attached to an Agent through an AgentInstance's `spec.environment_refs`. The AgentInstance holds a reference — not a copy:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-production
  org: acme-corp
spec:
  agent_id: agt_abc123
  environment_refs:
    - kind: 52           # enum value for environment
      id: env_gh_prod789
      name: github-prod-secrets
      org: acme-corp
```

The runner fetches and decrypts the actual values at execution start — the AgentInstance itself never holds secrets.

### Layered Merging

An AgentInstance can reference multiple Environments in an ordered list. They are merged **left to right** — later entries override earlier ones for any shared key:

```yaml
environment_refs:
  - name: global-defaults        # non-secret defaults for all agents
  - name: platform-team-config   # team-specific settings
  - name: production-secrets     # credentials — highest priority
```

This layering pattern keeps configuration DRY: a shared `global-defaults` environment sets common values; team and environment-specific environments layer on top without duplication.

### Resolved at Execution Start

When an AgentExecution begins, the runner resolves all Environments referenced by the bound AgentInstance, merges them in order, and injects the resulting key-value map into the agent sandbox. The keys made available are recorded in `status.resolved_context.environment_keys` — values are never logged.

If a required key has no value after merging, the execution fails immediately with a descriptive error before the agent starts.

---

## Reusability: One Environment, Many Agents

Because Environments are independent resources, the same Environment can be referenced across any number of AgentInstances:

```
github-prod-secrets
    ├── code-review-bot-production
    ├── pr-merge-agent-production
    └── release-agent-production
```

All three instances share the same token. Rotate it once in `github-prod-secrets` — all three agents use the new value on their next execution. No instance needs to be updated.

---

## Secret Rotation Without Downtime

Updating a secret in an Environment takes effect on the next execution. There is no restart, no redeployment, no change to any AgentInstance or Agent.

```bash
# Update the environment with the new token
stigmer environment apply env.yaml

# The next execution automatically uses the new value
stigmer run github-bot-production "Review the latest PR"
```

---

## Access Control

Environments carry sensitive data, so access is tightly controlled:

| Operation | Permission Required | Notes |
|---|---|---|
| `create` | `can_create_environment` on the owning org | Environments are org-scoped. |
| `update` | `can_edit` on the environment | Full state replacement — always provide the complete spec. |
| `delete` | `can_edit` on the environment | Deleting an Environment referenced by an active AgentInstance causes future executions to fail. |
| `get` | `can_view` on the environment | Secret values are **never returned** — only keys and non-secret values. |

Secret values are only ever available inside the running agent sandbox. Users who can view an Environment can see which keys it contains and their descriptions, but cannot read secret values through any API or CLI call.

---

## Getting Started

```bash
# Apply an environment from a YAML file
stigmer environment apply env.yaml

# Create an environment inline
stigmer environment create --name "github-prod-secrets" --org acme-corp

# Inspect an environment (secret values are redacted)
stigmer environment get github-prod-secrets --output yaml

# List all environments in an org
stigmer environment list --org acme-corp

# Update an environment to rotate a secret — always provide complete spec
stigmer environment apply env-updated.yaml

# Delete an environment no longer needed
stigmer environment delete github-staging-secrets
```

---

## How It Compares

| Without Environment | With Environment |
|---|---|
| Credentials embedded in Agent YAML or application code | Secrets live in Environment resources; Agent YAML contains no values |
| Rotating a token means finding every agent and call site that uses it | Update the Environment once; all referencing agents pick it up on next execution |
| Staging and production share the same credentials, or require duplicated agent definitions | Separate Environments per deployment; same Agent and Instance structure throughout |
| No audit trail of which credentials were active during a past execution | Resolved keys captured at execution start in `resolved_context.environment_keys` |
| Sharing an agent through the marketplace also shares its credentials | Agent is credential-free; consumers bring their own Environment |
| Per-customer secret injection has no clean model | One Environment per customer, referenced by a per-customer AgentInstance |
| No structured distinction between secrets and plain config | Each key is individually marked — secrets encrypted, plain config stored as plaintext |

---

## Further Reading

- [What is an Agent Instance?](./what-is-agent-instance.md) — How Environments are bound to Agents via AgentInstance
- [What is an Agent?](./what-is-agent.md) — The blueprint that declares which environment variables are required
- [What is an Agent Execution?](./what-is-agent-execution.md) — Where Environments are resolved and injected at runtime
- [Environment Resource Guide](../../apis/ai/stigmer/agentic/environment/docs/environment-resource-guide.md) — Complete spec and status schema reference
- [Environment Examples](../../apis/ai/stigmer/agentic/environment/docs/examples.md) — Complete YAML examples from minimal to full-featured
- [Environment Binding](../../apis/ai/stigmer/agentic/agentinstance/docs/environment-binding.md) — Layered merging and resolution in depth
