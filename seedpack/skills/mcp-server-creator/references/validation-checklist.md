# Validation Checklist and Common Pitfalls

Run through this list before presenting any McpServer YAML to the user.

## Pre-Apply Checklist

### Required Fields
- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer` (PascalCase — not `mcpserver`, `Mcpserver`, `mcp_server`, or `MCP_SERVER`)
- [ ] `metadata.name` is present
- [ ] Exactly one of `spec.stdio` or `spec.http` is specified (not both, not neither)
- [ ] `spec.description` is present and explains what the server does

### stdio Servers
- [ ] `spec.stdio.command` is present
- [ ] Command is a real, recognized executable (`npx`, `python`, `node`, absolute path, etc.)
- [ ] `working_dir` uses an absolute path if specified
- [ ] All credentials used by the server are declared in `spec.env_spec`

### HTTP Servers
- [ ] `spec.http.url` is a valid HTTP or HTTPS URL (not relative, not missing scheme)
- [ ] Every `${VAR_NAME}` in `headers` or `query_params` has a corresponding `env_spec` entry
- [ ] `timeout_seconds` is between 0 and 300 if specified

### Organization and Visibility
- [ ] `metadata.org` is set — use `default` for local/default org, or the explicit org slug
- [ ] `visibility_public` only if the server is intentionally being published to the marketplace
- [ ] For public servers, `env_spec` descriptions are detailed enough for external users

### Tool Names
- [ ] All names in `default_enabled_tools` are real, verified tool names from the server (not guessed)
- [ ] All `tool_name` values in `default_tool_approvals` are verified (case-sensitive, exact match)
- [ ] Remind user to run `stigmer discover mcp-server <slug>` after applying to verify

### env_spec
- [ ] Secret values are never pre-filled in the spec (`value:` field is empty for secrets)
- [ ] Each env var has a useful `description` explaining format and required permissions

### YAML
- [ ] `status` is omitted or left as `{}` — never populated by users
- [ ] No tabs (YAML uses spaces)
- [ ] `spec.env_spec.data` values are properly indented

---

## Critical Pitfalls

### 1. Wrong kind capitalization

```yaml
# Wrong — any of these
kind: mcpserver
kind: Mcpserver
kind: mcp_server
kind: MCP_SERVER

# Correct
kind: McpServer
```

Context: `kind: mcp_server` (snake_case) is only valid in `ApiResourceReference` inside Agent YAML.
In the McpServer resource itself, `kind: McpServer` (PascalCase) is always required.

---

### 2. Both or neither server_type specified

The proto `oneof server_type` with `required` validation rejects both of these:

```yaml
# Wrong — no server type
spec:
  description: "GitHub MCP server"

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

---

### 3. Confusing `${VAR_NAME}` and `{{args.field}}`

These look similar but are completely different mechanisms:

| Syntax | Used In | Resolved By | When |
|---|---|---|---|
| `${VAR_NAME}` | HTTP `headers` and `query_params` | Agent runner, from AgentInstance env | At connection time |
| `{{args.field}}` | Approval `message` templates | Approval engine, from tool arguments | At tool call time |

```yaml
# Wrong — ${} in approval message
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete ${args.repo}"      # will NOT resolve

# Wrong — {{}} in HTTP header
http:
  headers:
    Authorization: "Bearer {{API_TOKEN}}"  # will NOT resolve

# Correct
http:
  headers:
    Authorization: "Bearer ${API_TOKEN}"   # environment variable
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"  # tool argument
```

---

### 4. Tool names that are guessed, not verified

Tool names in `default_enabled_tools` and `default_tool_approvals` that don't match the server's `tools/list` are **silently ignored**. No error. The tool simply won't be available (or approval won't be enforced).

```yaml
# Dangerous — tool names guessed
default_enabled_tools:
  - searchCode         # probably should be search_code
  - GetFileContents    # probably should be get_file_contents

# Correct workflow
# 1. stigmer apply -f mcpserver.yaml
# 2. stigmer discover mcp-server github
# 3. stigmer get mcp-server github --output yaml  ← copy from status.discovered_capabilities.tools[*].name
default_enabled_tools:
  - search_code
  - get_file_contents
```

**Always note this to the user:** tell them to run discovery and verify tool names before relying on them in agents or approval policies.

---

### 5. Secrets pre-filled in spec

```yaml
# Wrong — secret value in spec (never commit credentials to version control)
env_spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_realtoken123"
      is_secret: true

# Correct — schema only, values provided via AgentInstance at runtime
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo scope"
      is_secret: true
```

---

### 6. Setting status fields

```yaml
# Wrong
status:
  validation_state: valid
  discovered_capabilities:
    tools: [...]

# Correct — omit status entirely
# or leave as empty object if your serializer requires it:
# status: {}
```

---

### 7. Invalid slug format

```yaml
# Wrong
slug: GitHub             # uppercase
slug: github_mcp         # underscore (use hyphens)
slug: 123-mcp            # starts with digit
slug: My MCP Server      # spaces

# Correct
slug: github
slug: github-mcp
slug: my-db-v2
```

---

### 8. Missing `metadata.org` in cloud mode

The org field defaults from CLI context if omitted during `stigmer apply`. Always set it explicitly for clarity and portability:

```yaml
metadata:
  name: github
  org: default          # use 'default' for the default organization
  # or:
  org: acme-corp        # explicit org slug
```

---

## After Delivery Reminders

After presenting the YAML, always remind the user to:

1. **Apply:** `stigmer apply -f mcpserver.yaml`
2. **Discover tools:** `stigmer discover mcp-server <slug>`
3. **Verify:** `stigmer get mcp-server <slug> --output yaml`
   - Check `status.validation_state: valid`
   - Check `status.discovered_capabilities.tools` to verify tool names
4. **Update tool lists** if discovered names differ from what was put in `default_enabled_tools` or `default_tool_approvals`
