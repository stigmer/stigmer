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
- [ ] `metadata.visibility` is intentional — omit or set `visibility_private` for internal use, set `visibility_public` only for marketplace publishing
- [ ] For public servers, `spec.env_spec` descriptions are detailed enough for external users to know exactly what credentials to provide

### Tool Names

- [ ] All tool names in `spec.default_enabled_tools` have been verified against the server's `tools/list` (run `stigmer discover mcp-server <slug>`) — **server-enforced at apply time**: once the server has discovered capabilities, update/apply rejects unknown names with `INVALID_ARGUMENT` listing the valid tools
- [ ] `default_enabled_tools` contains **only** names from `discovered_capabilities.tools` — never from `discovered_capabilities.resource_templates` (resource templates are data endpoints, not callable tools; also server-enforced at apply time, with a targeted error)
- [ ] All `tool_name` values in `spec.default_tool_approvals` match exactly (case-sensitive) what the server reports — typos are silently ignored

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

### Confusing `${VAR_NAME}` with `{{args.field}}`

These two placeholder syntaxes look similar but are completely different:

| Syntax | Where Used | Resolved By | When |
|---|---|---|---|
| `${VAR_NAME}` | HTTP `headers` and `query_params` values | Agent runner, from AgentInstance environment | At server startup/request time |
| `{{args.field}}` | `default_tool_approvals.message` and agent `tool_approval_overrides.message` | Approval engine, from tool call arguments | At tool invocation time |

```yaml
# Wrong — using ${} in an approval message
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete ${args.repo}"     # Won't resolve — wrong syntax for this context

# Wrong — using {{}} in an HTTP header
http:
  headers:
    Authorization: "Bearer {{API_TOKEN}}"   # Won't resolve — wrong syntax for this context

# Correct — each syntax in its proper place
http:
  headers:
    Authorization: "Bearer ${API_TOKEN}"   # environment variable

default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"   # tool argument
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

### `default_enabled_tools` with unverified tool names

Tool names must match exactly what the MCP server reports via `tools/list`. Once the server has discovered capabilities, an update/apply carrying an unknown name is rejected with `INVALID_ARGUMENT` listing the valid tools. Before the first discovery (a brand-new server), the name passes apply unchecked and the runner warns and ignores it at execution — agents won't see that tool as available.

```yaml
# Potentially wrong — tool names guessed, not verified
default_enabled_tools:
  - searchCode         # should be search_code?
  - GetFileContents    # should be get_file_contents?

# Correct workflow — always discover first
# 1. stigmer apply -f mcpserver.yaml
# 2. stigmer discover mcp-server github
# 3. stigmer get mcp-server github --output yaml   <- copy names from here
default_enabled_tools:
  - search_code
  - get_file_contents
```

### Typos in `tool_name` inside `default_tool_approvals`

If a `tool_name` doesn't match any tool from the server's `tools/list`, the approval policy is **silently ignored**. No error. No warning. The tool runs without approval as if no policy existed.

```yaml
# Dangerous — typo silently disables the approval policy
default_tool_approvals:
  - tool_name: delete_repositry    # typo: 'repositry' instead of 'repository'
    message: "Delete repository: {{args.repo}}"

# Correct
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"
```

Mitigation: always run `stigmer discover mcp-server <slug>` and copy tool names directly from `status.discovered_capabilities.tools[*].name`.

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

After applying a new or updated McpServer, the `status.discovered_capabilities` is empty (or stale) until discovery is run. Agents can still reference the server, but you cannot verify tool names or write accurate approval policies.

```bash
# Always run this after apply
stigmer apply -f mcpserver.yaml
stigmer discover mcp-server <slug>

# Verify
stigmer get mcp-server <slug> --output yaml
```
