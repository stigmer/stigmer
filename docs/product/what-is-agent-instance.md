# What is an Agent Instance?

## One-Sentence Positioning

**An Agent Instance is a configured deployment of an Agent template—the same way a Docker Compose service definition binds a Docker image to its runtime environment, secrets, and credentials.**

---

## Executive Summary

An AgentInstance is the layer between the Agent blueprint and live execution. The Agent declares *what* it needs—which environment variables, which credentials—without providing the actual values. The AgentInstance supplies those values by binding one or more Environment resources to the Agent template.

AgentInstance sits at the second layer of the four-layer stack:

```
Agent ──► AgentInstance ──► Session ──► AgentExecution
```

Every Agent gets a **default instance** created automatically at creation time. The default instance has no environment bindings and lets you run the agent immediately with `stigmer run`—no configuration required. Named instances exist for when you need to supply credentials: a production GitHub token, a staging API key, a per-customer OAuth secret.

The separation is the point: the same Agent YAML runs in staging and production without modification. You create one AgentInstance per environment, each pointing at a different set of credentials. The blueprint never changes. Only the binding does.

---

## The Problem Agent Instance Solves

### Credentials Belong to Deployments, Not Blueprints

A typical hardcoded approach mixes secrets with logic:

```python
client = anthropic.Anthropic()
response = client.messages.create(
    system="You are a code review assistant...",
    tools=[github_tool],
    messages=[{"role": "user", "content": user_input}],
)

# Credentials are embedded in the tool or the application code
github_tool = GithubTool(token=os.getenv("GITHUB_TOKEN"))
```

This works until you need to run the same agent with different credentials—staging vs. production, one customer vs. another, your token vs. a colleague's token.

**What goes wrong:**

- Running the same agent against staging vs. production requires duplicating the agent definition with different hardcoded secrets, or adding credential-selection logic to the application code.
- Rotating a credential means finding every place it is referenced and updating application code.
- Per-customer deployments—where each customer's agent run uses their own API key—have no clean model. The secret either lives in the agent definition (wrong), the session (leaky), or the calling application (scattered).
- A team can share an Agent definition through the marketplace, but the consumer cannot bring their own credentials without forking the agent.
- There is no audit trail of which credentials were in use when a specific execution ran.

### AgentInstance as the Answer

AgentInstance separates the *what* (Agent spec) from the *who and where* (environment bindings):

- The Agent spec declares `GITHUB_TOKEN` is required, with `is_secret: true`. No value is stored in the Agent.
- An AgentInstance named `github-bot-production` references an Environment resource that holds the actual production token.
- A second AgentInstance named `github-bot-staging` references a different Environment with staging credentials.
- Both instances run the same Agent. Rotating the production token means updating the Environment resource—nothing else changes.

---

## The AgentInstance Resource

AgentInstance follows the standard Stigmer resource pattern: a `spec` for what you configure, and a `status` for what the system manages.

### The Spec: What You Configure

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: github-bot-production
  org: acme-corp
  labels:
    env: production
    team: platform
spec:
  # The Agent template this instance deploys.
  agent_id: agt_abc123

  # Human-readable description to distinguish this instance from others.
  description: "Production GitHub bot for the main monorepo"

  # One or more Environment resources to bind to this instance.
  # Merged in order — later environments override earlier ones for shared keys.
  environment_refs:
    - kind: 52             # enum value for environment
      id: env_base001
      name: base-config
      org: acme-corp
    - kind: 52
      id: env_gh_prod789
      name: github-prod-secrets
      org: acme-corp
```

**Spec fields at a glance:**

| Field | Required | Description |
|---|---|---|
| `agent_id` | Yes | The Agent template to deploy. Validated: must be a non-empty string. |
| `description` | No | Human-readable label for this instance. Shown in the UI and `list` output to distinguish multiple instances of the same agent. |
| `environment_refs` | No | Ordered list of Environment resources to bind. Merged left-to-right; later entries override earlier ones for any shared key. |

### The Status: What the System Manages

The AgentInstance status is an audit record. You never set it—it is maintained by the system.

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

## Environment Binding

The core of AgentInstance is the merge of one or more Environment resources into a unified set of key-value pairs that the agent receives at execution time.

### How Environments Are Merged

Environments are merged **left to right** — later entries override earlier ones for any shared key:

```
Agent defaults  <  environment_refs[0]  <  environment_refs[1]  <  ...  <  runtime_env
```

**Example:**

| Source | `LOG_LEVEL` | `GITHUB_TOKEN` |
|---|---|---|
| Agent default | `"info"` | *(not declared)* |
| `base-config` (index 0) | `"debug"` | *(not set)* |
| `github-prod-secrets` (index 1) | `"warn"` | `"ghp_..."` |

**Result at execution time:** `LOG_LEVEL = "warn"`, `GITHUB_TOKEN = "ghp_..."`.

### Layered Configuration Pattern

This merge order unlocks a clean layering pattern. A common enterprise setup uses three layers:

```yaml
environment_refs:
  - name: global-defaults       # non-secret defaults shared across all agents
  - name: platform-team-config  # team-specific settings (Slack channel, etc.)
  - name: production-secrets    # credentials for this specific environment
```

Switch from staging to production by changing only the last environment reference. The global defaults and team config remain untouched.

### Runtime Injection — The Execution Layer

Above the instance-level environments sits one more layer: `runtime_env` on the AgentExecution. This is the highest-priority source and is scoped to a single execution — the values are deleted when the execution completes.

```yaml
# Set when creating an AgentExecution
spec:
  runtime_env:
    CUSTOMER_API_KEY:
      value: "cust_xyz..."
      is_secret: true
```

Use `runtime_env` for B2B integrations where each caller injects their own credentials at runtime, rather than storing per-customer secrets in a shared instance configuration.

### Resolution at Execution Start

When an AgentExecution is created, the runner resolves all environments from the bound instance. The result is captured in `status.resolved_context.environment_keys` — the keys available to the agent (values are never exposed for security). If a required key has no value after merging, the execution fails immediately before the agent starts.

---

## Scope and Access Control

An AgentInstance can be scoped to an organization or an individual identity account:

| Scope | Description | Use case |
|---|---|---|
| **Organization** | Instance belongs to an org. All org members with `can_view` permission can see it. | Shared team credentials for a GitHub or Jira bot. |
| **Identity account** | Instance belongs to a specific user. Isolated from other org members. | Personal API keys or per-user OAuth tokens. |

Authorization follows Fine-Grained Authorization (FGA):

| Operation | Permission required |
|---|---|
| Create | `can_create_instance` on the parent Agent |
| Update | `can_edit` on the instance |
| Delete | `can_delete` on the instance |
| Get | `can_view` on the instance |
| List by agent | FGA query filters to only instances the caller has `can_view` on |

---

## Multiple Instances Per Agent

There is no limit to how many instances a single Agent can have. Common patterns:

**Environment promotion:**

```
github-bot-dev      → [dev-github-secrets]
github-bot-staging  → [base-config, staging-github-secrets]
github-bot-prod     → [base-config, prod-github-secrets]
```

**Per-team deployments:**

```
github-bot-platform-team   → [base-config, platform-team-config]
github-bot-infra-team      → [base-config, infra-team-config]
```

**Per-customer (B2B SaaS):**

```
github-bot-customer-acme   → [base-config, acme-github-secrets]
github-bot-customer-widget → [base-config, widget-github-secrets]
```

In all cases, the Agent YAML is authored once and never changes.

---

## Getting Started

```bash
# Run an agent with its default instance — no configuration needed
stigmer run my-agent "Review the latest PR"

# Create a named instance that binds production credentials
stigmer agent instance create \
  --agent my-github-agent \
  --env github-prod-secrets \
  --name "GitHub Bot Production" \
  --org acme-corp

# Run using a specific named instance
stigmer run my-github-agent "Review the latest PR" --instance github-bot-production

# List all instances for an agent
stigmer agent instance list --agent my-github-agent

# Inspect an instance as YAML
stigmer agent instance get github-bot-production --output yaml

# Update — always provide complete spec (no partial updates)
stigmer agent instance apply instance.yaml

# Delete an instance no longer needed
stigmer agent instance delete github-bot-staging
```

---

## How It Compares

| Without AgentInstance | With AgentInstance |
|---|---|
| Credentials baked into Agent YAML or application code | Secrets live in Environment resources; Agent YAML has none |
| Staging and production require duplicate Agent definitions | One Agent, separate instances for each environment |
| Rotating a credential means finding every reference in code | Update the Environment resource; all instances pick it up on next execution |
| Per-customer secret injection has no clean model | `runtime_env` on AgentExecution injects per-call secrets without storing them |
| No record of which credentials were used in a past execution | `resolved_context.environment_keys` captured at execution start |
| Sharing an agent means sharing its credentials too | Credentials stay in the instance; the Agent template is credential-free |

---

## Further Reading

- [What is an Agent?](./what-is-agent.md) — The blueprint that AgentInstance deploys
- [What is an Agent Execution?](./what-is-agent-execution.md) — A single run of an instance within a session
- [AgentInstance Resource Guide](../../apis/ai/stigmer/agentic/agentinstance/docs/agent-instance-resource-guide.md) — Complete spec and status schema reference
- [Environment Binding](../../apis/ai/stigmer/agentic/agentinstance/docs/environment-binding.md) — Layered environment merging and resolution in depth
- [AgentInstance Examples](../../apis/ai/stigmer/agentic/agentinstance/docs/examples.md) — Complete YAML examples from minimal to full-featured
