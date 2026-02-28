# Environment Binding

How environments are attached to an AgentInstance, merged in order, and resolved at execution time.

---

## What Is an Environment?

An Environment is a named collection of key-value pairs — secrets, credentials, and configuration that an Agent needs at runtime. The Agent spec declares _which_ variables it requires (via `env_spec`), and the AgentInstance supplies the _values_ by binding one or more Environment resources.

This separation keeps Agent templates reusable: the same Agent YAML can be deployed against a staging environment or a production environment without modification.

---

## How Environments Are Bound

An AgentInstance's `spec.environment_refs` holds an ordered list of Environment references:

```yaml
spec:
  agent_id: agt_abc123
  environment_refs:
    - kind: 52
      id: env_base123
      name: base-config
    - kind: 52
      id: env_prod456
      name: github-prod-secrets
```

Multiple environments are supported. The list is ordered — this order determines which values win when the same key appears in more than one environment.

---

## Merge Order

Environments are merged **left to right** — later entries override earlier ones for any shared keys.

```
Agent defaults  <  environment_refs[0]  <  environment_refs[1]  <  ...  <  runtime_env
```

**Example:**

| Source | Key | Value |
|---|---|---|
| Agent default | `LOG_LEVEL` | `"info"` |
| `env_base123` (index 0) | `LOG_LEVEL` | `"debug"` |
| `env_prod456` (index 1) | `LOG_LEVEL` | `"warn"` |

Result at execution time: `LOG_LEVEL = "warn"` (the last source in the chain wins).

This layering pattern enables:

- **Base + override**: A shared base environment holds non-secret defaults; a team-specific environment adds credentials.
- **Environment promotion**: Switch from staging to production by replacing the last environment reference, not the agent.
- **Per-user injection**: Execution-scoped `runtime_env` (set when creating an AgentExecution) sits at the top of the stack, allowing per-caller secret injection without touching the instance configuration.

---

## Resolution at Execution Start

When an AgentExecution is created, the runner resolves all environment references from the instance. The result is captured in `AgentExecutionStatus.resolved_context.environment_keys` — the keys available to the agent (values are never exposed for security).

Resolution can fail if:

- An Environment resource referenced by ID no longer exists.
- The instance does not have `can_view` permission on the referenced Environment.
- A required key declared in the Agent's `env_spec` has no value after merging.

When resolution fails, the execution fails immediately with a descriptive error in `ResolvedExecutionContext.mcp_servers[].message` (for MCP dependencies) or `status.error` (for missing required keys). The agent never starts.

---

## Priority Stack

The full priority stack from lowest to highest:

```
1. Agent env_spec defaults (lowest)
2. environment_refs[0]
3. environment_refs[1]
   ...
4. environment_refs[N] (highest among instance-level sources)
5. runtime_env on AgentExecution (highest — per-call injection)
```

`runtime_env` is set when creating an AgentExecution and is scoped to that single execution. It is deleted when the execution completes. Use it for B2B integrations where a caller injects their own credentials at runtime without storing them in the instance.

---

## No Environments (Default Instance)

Every Agent has a default instance with no environment references. This instance works for agents that either:

- Require no secrets (e.g., pure reasoning agents with no external API calls).
- Have all required values pre-populated as non-secret defaults in the Agent's `env_spec`.

```yaml
spec:
  agent_id: agt_abc123
  # No environment_refs — uses agent defaults only
```

If you run the default instance for an agent that requires secrets, the execution fails immediately with a missing-environment-variable error.

---

## Visibility and Access

The AgentInstance holds references to Environments, not copies of their values. The runner resolves values at execution time using the service account attached to the runner — not the end user's identity.

This means:

- Users who can `get` an AgentInstance can see _which_ environments are referenced (by name and ID), but cannot read secret values.
- Secret values are only available inside the running agent sandbox.
- Rotating a secret in the Environment resource takes effect on the next execution with no changes to the AgentInstance.

---

## Relationship to MCP Server Resolution

MCP servers configured on the Agent may require specific environment keys (e.g., `GITHUB_TOKEN` for the GitHub MCP server). After environment merging, the runner injects these values into each MCP server's configuration. If a required key is missing for an MCP server, that server's `resolved` flag is set to `false` and `enabled_tool_count` is `0` — the agent starts but cannot use that server's tools.

See [AgentExecution resolved context](../../agentexecution/docs/agent-execution-resource-guide.md#resolved-execution-context) for the full resolution status schema.
