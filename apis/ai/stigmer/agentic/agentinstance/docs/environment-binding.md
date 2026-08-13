# Environment Binding

How environments are attached to an AgentInstance, merged in order, and resolved at execution time.

---

## What Is an Environment?

An Environment is a named collection of key-value pairs — secrets, credentials, and configuration that an Agent needs at runtime. The Agent spec declares _which_ variables it uses (via `spec.env`, a map of name → declaration with `is_secret` and `optional` flags — declarations carry no values), and the AgentInstance supplies the _values_ by binding one or more Environment resources.

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
environment_refs[0]  <  environment_refs[1]  <  ...  <  runtime_env
```

The Agent itself contributes no values: its `spec.env` declarations are a key whitelist, not a bottom layer (see [Declared-Key Filtering](#declared-key-filtering) below).

**Example:**

| Source | Key | Value |
|---|---|---|
| `env_base123` (index 0) | `LOG_LEVEL` | `"debug"` |
| `env_prod456` (index 1) | `LOG_LEVEL` | `"warn"` |

Result at execution time: `LOG_LEVEL = "warn"` (the last source in the chain wins).

This layering pattern enables:

- **Base + override**: A shared base environment holds non-secret defaults; a team-specific environment adds credentials.
- **Environment promotion**: Switch from staging to production by replacing the last environment reference, not the agent.
- **Per-user injection**: Execution-scoped `runtime_env` (set when creating an AgentExecution) sits at the top of the stack, allowing per-caller secret injection without touching the instance configuration.

---

## Declared-Key Filtering

After merging, the result is filtered to the keys declared in the Agent's `spec.env` — least privilege: an agent only receives the variables it explicitly declared, even when a bound Environment contains additional secrets. Undeclared keys are dropped (and logged). An agent that declares no variables receives the full merged map unchanged.

A declared key marked required (`optional: false`, the default) that has no value after merging is **a warning, not a failure** — the execution proceeds and fails downstream with a clearer domain error (for example an MCP server authentication failure) if the variable was truly needed.

---

## Resolution at Execution Start

When an AgentExecution is created, the server resolves all environment references from the instance, merges and filters them, and persists the result as the execution's ExecutionContext. The keys are later reported in `AgentExecutionStatus.resolved_context.environment_keys` — the keys available to the agent (values are never exposed for security).

Resolution fails the create if:

- An Environment resource that is referenced no longer exists.
- The caller is not permitted to read the referenced Environment.

A required key declared in the Agent's `spec.env` that has no value after merging does **not** fail the create — it logs a warning and the execution proceeds (see [Declared-Key Filtering](#declared-key-filtering)). MCP servers whose required variables are missing surface per-server diagnostics in `ResolvedExecutionContext.mcp_servers[].message`.

---

## Priority Stack

The full priority stack from lowest to highest:

```
1. environment_refs[0] (lowest)
2. environment_refs[1]
   ...
3. environment_refs[N] (highest among instance-level sources)
4. runtime_env on AgentExecution (highest — per-call injection)
```

The whole stack is then filtered to the Agent's declared keys (see [Declared-Key Filtering](#declared-key-filtering)).

`runtime_env` is set when creating an AgentExecution and is scoped to that single execution. It is deleted when the execution completes. Use it for B2B integrations where a caller injects their own credentials at runtime without storing them in the instance.

---

## No Environments (Default Instance)

Every Agent has a default instance with no environment references. This instance works for agents that require no secrets (e.g., pure reasoning agents with no external API calls), or when every needed value is supplied per call via `runtime_env`.

```yaml
spec:
  agent_id: agt_abc123
  # No environment_refs — no Environment values are merged
```

If you run the default instance for an agent that declares required variables, the create logs a missing-required-variable warning and the execution proceeds — expect it to fail downstream (for example with an MCP server authentication error) if the variable was truly needed.

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
