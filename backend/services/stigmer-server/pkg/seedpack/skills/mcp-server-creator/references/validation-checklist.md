# Validation Checklist and Common Pitfalls

## Pre-Apply Checklist

Run through every item before presenting the final YAML.

### Required Fields
- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer` (PascalCase)
- [ ] `metadata.name` is present
- [ ] Exactly one of `spec.stdio` or `spec.http` is specified
- [ ] `spec.description` is present (strongly recommended)

### For Stdio Servers
- [ ] `spec.stdio.command` is a real executable (binary on `PATH` or absolute path)
- [ ] `spec.stdio.working_dir` is an absolute path if specified
- [ ] All required environment variables are in `spec.env_spec`

### For HTTP Servers
- [ ] `spec.http.url` is a valid HTTP or HTTPS URL
- [ ] Every `${VAR_NAME}` placeholder in headers/params has a corresponding `env_spec` entry
- [ ] `timeout_seconds` is in range 0–300 if specified

### Metadata
- [ ] `metadata.org` is `local` (local mode) or your real org slug (cloud mode)
- [ ] `metadata.slug` (if set) is lowercase, hyphens only, starts with a letter, max 63 chars
- [ ] `metadata.visibility` is intentional — omit or `visibility_private` for internal, `visibility_public` only for marketplace

### Tool Names
- [ ] All names in `default_enabled_tools` verified against the server's actual `tools/list`
- [ ] All `tool_name` values in `default_tool_approvals` match exactly (case-sensitive) — typos are silently ignored, no error is raised
- [ ] `{{args.field}}` placeholders in messages match actual argument names from the tool's `input_schema`

### env_spec
- [ ] No secret values pre-filled (`value` field is empty for secrets)
- [ ] All `is_secret` classifications are correct
- [ ] Descriptions are specific enough for users to know what to provide and what permissions are needed

### YAML Syntax
- [ ] `status` is omitted or left as `status: {}` — never manually set
- [ ] Proper indentation throughout (no tabs)

---

## Common Pitfalls

### 1. Wrong `kind` or `apiVersion`

```yaml
# Wrong
kind: mcpserver          # lowercase
kind: Mcpserver          # wrong casing
kind: mcp_server         # snake_case (valid in mcp_server_ref, NOT here)
apiVersion: stigmer.ai/v1
apiVersion: agentic/v1
apiVersion: v1

# Correct
kind: McpServer
apiVersion: agentic.stigmer.ai/v1
```

### 2. Missing server type (`stdio` or `http`)

```yaml
# Wrong — no server type
spec:
  description: "..."
  env_spec: {}

# Wrong — both specified (invalid oneof)
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

### 3. Mixing `${VAR_NAME}` and `{{args.field}}` placeholders

```yaml
# Wrong — ${} in approval message (won't resolve)
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete ${args.repo}"

# Wrong — {{}} in HTTP header (won't resolve)
http:
  headers:
    Authorization: "Bearer {{API_TOKEN}}"

# Correct
http:
  headers:
    Authorization: "Bearer ${API_TOKEN}"       # env substitution
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"  # tool arg template
```

### 4. Tool names guessed instead of verified

Unverified tool names are silently ignored — no error, the tool simply won't be gated or approved.

```yaml
# Dangerous — names guessed, may not match
default_enabled_tools:
  - searchCode          # should be search_code?
  - GetFileContents     # should be get_file_contents?

# Correct workflow:
# 1. stigmer mcp-server apply mcpserver.yaml
# 2. stigmer discover mcp-server <slug>
# 3. stigmer mcp-server get <slug> --output yaml
#    copy names from: status.discovered_capabilities.tools[*].name
```

### 5. Pre-filled secret values in env_spec

```yaml
# Wrong — secret in spec (never commit this)
env_spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_realtoken123"
      is_secret: true

# Correct — schema only; value provided via AgentInstance at runtime
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo scope"
      is_secret: true
```

### 6. Setting status fields

```yaml
# Wrong — system-managed, will be overwritten
status:
  validation_state: valid
  discovered_capabilities:
    tools: [...]

# Correct — omit status, or leave as {}
status: {}
```

### 7. Invalid slug format

```yaml
# Wrong
slug: GitHub             # uppercase
slug: github_mcp         # underscores not allowed
slug: 123-github         # must start with letter
slug: GitHub-MCP-Server  # mixed case

# Correct
slug: github
slug: github-mcp
slug: my-internal-db-v2
```

### 8. Missing `metadata.org` in cloud mode

In cloud mode, omitting `org` fails authorization. In local mode, it defaults to `local`.

```yaml
# Correct for cloud mode
metadata:
  name: github
  org: acme-corp   # required in cloud mode
```

### 9. Forgetting discovery after apply

After applying, `status.discovered_capabilities` is empty until discovery runs. You cannot verify tool names or write accurate approval policies until you run:

```bash
stigmer mcp-server apply mcpserver.yaml
stigmer discover mcp-server <slug>
stigmer mcp-server get <slug> --output yaml
```
