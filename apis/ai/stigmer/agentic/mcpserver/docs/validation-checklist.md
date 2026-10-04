# Validation Checklist and Common Pitfalls

Pre-apply checklist and known pitfalls when authoring McpServer YAML files.

## Pre-Apply Checklist

Run through this list before applying an McpServer YAML with `stigmer apply -f`.

### Required Fields

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer`
- [ ] `metadata.name` is present
- [ ] Exactly one of `spec.stdio` or `spec.http` is specified (the `server_type` oneof is required — omitting both, or providing both, will fail validation)
- [ ] `spec.description` explains what the server does and its primary use cases (strongly recommended — servers without descriptions are difficult to discover and configure)

### For Stdio Servers

- [ ] `spec.stdio.command` is present
- [ ] The command is a real executable (binary name on `PATH` or absolute path)
- [ ] `spec.stdio.working_dir` uses an absolute path if specified (relative paths depend on the agent runner's working directory, which may vary)
- [ ] All required environment variables are declared in `spec.env_spec`

### For HTTP Servers

- [ ] `spec.http.url` is a valid HTTP or HTTPS URL (validated by `buf.validate`)
- [ ] Every `${VAR_NAME}` placeholder in `headers` and `query_params` has a corresponding entry in `spec.env_spec`
- [ ] `spec.http.timeout_seconds` is in range 0–300 if specified

### Organization and Visibility

- [ ] `metadata.org` is set appropriately — `local` for local mode, your org slug for cloud mode
- [ ] `metadata.visibility` is intentional — omit for the organization default, `visibility_private` to keep it to yourself, `visibility_platform` only from an organization that operates an identity provider
- [ ] For a server carried in a plugin, `spec.env_spec` descriptions are detailed enough for an installing organization to know exactly what credentials to provide

### Tool Names

- [ ] The spec declares no tool settings: an agent narrows a server's tools with its own `tools` and `disallowed_tools` lists
- [ ] Tools that should ask for approval are annotated `destructiveHint: true` by the server itself; after connecting, `status.discovered_capabilities.tools[].destructive_hint` shows which ones Stigmer will ask about

### YAML Syntax

- [ ] YAML is properly formatted and syntactically valid
- [ ] `spec.env_spec.data` values use correct indentation
- [ ] No trailing whitespace or tab characters

---

## Common Pitfalls

### Missing `server_type` — the oneof is required

The `server_type` oneof requires exactly one of `stdio` or `http`. Omitting both fails validation with a clear message.

```yaml
# Wrong — no server type specified
spec:
  description: "GitHub MCP server"
  env_spec: {}

# Wrong — both specified
spec:
  stdio:
    command: npx
  http:
    url: "https://example.com"

# Correct — exactly one
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

### Wrong `kind` capitalization

```yaml
# Wrong
kind: mcpserver
kind: Mcpserver
kind: mcp_server
kind: MCP_SERVER

# Correct
kind: McpServer
```

Note that `kind: McpServer` (PascalCase) in the resource YAML is different from `kind: mcp_server` (snake_case) in `ApiResourceReference` inside an Agent's `mcp_server_usages`. Both are correct for their respective contexts.

### Wrong `apiVersion`

```yaml
# Wrong
apiVersion: stigmer.ai/v1
apiVersion: agentic/v1
apiVersion: v1

# Correct
apiVersion: agentic.stigmer.ai/v1
```

### Using a placeholder syntax other than `${VAR_NAME}`

HTTP `headers` and `query_params` values resolve `${VAR_NAME}` from the AgentInstance's environment, at server startup or request time. No other placeholder syntax resolves.

```yaml
# Wrong — {{}} is not a placeholder here
http:
  headers:
    Authorization: "Bearer {{API_TOKEN}}"   # sent literally

# Correct
http:
  headers:
    Authorization: "Bearer ${API_TOKEN}"   # environment variable
```

### Using slugs in wrong format

Slugs must match `^[a-z][a-z0-9-]*$` — lowercase, hyphens only, starts with a letter, 1–63 characters.

```yaml
# Wrong
slug: GitHub             # uppercase
slug: github_mcp         # underscores
slug: 123-github         # starts with digit
slug: GitHub-MCP-Server  # mixed case

# Correct
slug: github
slug: github-mcp
slug: my-internal-db-v2
```

### Expecting a tool to ask for approval when the server does not mark it destructive

Stigmer asks before an MCP tool runs only when the server's own annotation marks it destructive (`destructiveHint: true`). A server that annotates nothing gates nothing. Check `status.discovered_capabilities.tools[].destructive_hint` after connecting. To keep an agent away from a tool instead, leave it out with the agent's tool lists:

```yaml
# In the Agent spec
disallowed_tools:
  - mcp__github__delete_repository   # exact name from status.discovered_capabilities.tools[*].name
```

### `env_spec` with values pre-filled for secrets

Secret values should never be pre-filled in the McpServer spec — they belong in the AgentInstance's environment binding and should never be in version control.

```yaml
# Wrong — secret value in spec
env_spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_realtoken123"   # Never do this
      is_secret: true

# Correct — schema only, value provided at runtime
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo scope"
      is_secret: true
      # value is empty — provided via AgentInstance environment at runtime
```

### Setting `status` fields in YAML

Status fields are system-managed and will be overwritten if set manually.

```yaml
# Wrong — status is never set by users
status:
  validation_state: valid
  discovered_capabilities:
    tools: [...]

# Correct — omit status entirely or leave as {}
status: {}
```

### Missing `metadata.org` in cloud mode

In cloud mode, `metadata.org` is required. Omitting it will fail authorization.

```yaml
# Wrong in cloud mode
metadata:
  name: github

# Correct for cloud mode
metadata:
  name: github
  org: acme-corp
```

If `org` is omitted, the CLI resolves it from the active context (`stigmer context show`).

### Forgetting to run discovery after apply

After applying a new or updated McpServer, the `status.discovered_capabilities` is empty (or stale) until discovery is run. Agents can still reference the server, but you cannot verify tool names for an agent's tool lists or see which tools are marked destructive.

```bash
# Always run this after apply
stigmer apply -f mcpserver.yaml
stigmer discover mcp-server <slug>

# Verify
stigmer get mcp-server <slug> --output yaml
```
