# Validation Checklist and Common Pitfalls

Run through this checklist before presenting any McpServer YAML to the user.

## Pre-Apply Checklist

### Required Fields
- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1` (not `stigmer.ai/v1`, not `v1`)
- [ ] `kind` is exactly `McpServer` (PascalCase — not `mcpserver`, `Mcpserver`, `mcp_server`, `MCP_SERVER`)
- [ ] `metadata.name` is present
- [ ] Exactly one of `spec.stdio` or `spec.http` is specified — not both, not neither
- [ ] `spec.description` is present and explains what the server does

### Metadata
- [ ] `metadata.slug` format: `^[a-z][a-z0-9-]*$` (lowercase, hyphens only, starts with letter, 1–63 chars)
- [ ] `metadata.org` is set: `local` for local mode, actual org slug for cloud mode
- [ ] `metadata.visibility` is intentional: `visibility_private` (default) or `visibility_public` (marketplace only)
- [ ] `status` is NOT set — system-managed only

### For Stdio Servers
- [ ] `spec.stdio.command` is present
- [ ] The command is a real executable (e.g., `npx`, `python`, `node`, or an absolute path)
- [ ] If `working_dir` is set, it uses an absolute path
- [ ] All credential env vars the server needs are declared in `spec.env_spec`

### For HTTP Servers
- [ ] `spec.http.url` is a valid HTTP or HTTPS URL
- [ ] Every `${VAR_NAME}` placeholder in `headers` and `query_params` has a matching entry in `spec.env_spec`
- [ ] `timeout_seconds` is in range 0–300 (if specified)

### env_spec
- [ ] Secret env vars have `is_secret: true` and NO pre-filled value
- [ ] Non-secret env vars have `is_secret: false`
- [ ] Each var's `description` explains the required format and permissions precisely
- [ ] `value` is empty for secrets (never put credentials in YAML)

### Tool Names
- [ ] All tool names in `default_enabled_tools` are verified (not guessed) — see discovery note below
- [ ] All `tool_name` values in `default_tool_approvals` exactly match (case-sensitive) what the server reports

### Approval Messages
- [ ] Approval messages use `{{args.field_name}}` syntax (double curly braces)
- [ ] Approval messages do NOT use `${VAR_NAME}` syntax (that's for HTTP env vars only)
- [ ] Messages are under ~100 characters for UI display

---

## Common Pitfalls

### ❌ Wrong `kind` capitalization
```yaml
kind: mcpserver      # wrong
kind: Mcpserver      # wrong
kind: mcp_server     # wrong (that's the reference kind in ApiResourceReference)
kind: MCP_SERVER     # wrong

kind: McpServer      # ✓ correct
```

### ❌ Wrong `apiVersion`
```yaml
apiVersion: stigmer.ai/v1        # wrong
apiVersion: agentic/v1           # wrong
apiVersion: v1                   # wrong

apiVersion: agentic.stigmer.ai/v1   # ✓ correct
```

### ❌ Missing or duplicate server_type
```yaml
# Wrong — no server type
spec:
  description: "..."
  env_spec: {}

# Wrong — both specified (validation error)
spec:
  stdio:
    command: npx
  http:
    url: "https://example.com"

# ✓ Correct — exactly one
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

### ❌ Confusing `${VAR_NAME}` with `{{args.field}}`
```yaml
# Wrong — ${} in approval message (won't resolve)
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete ${args.repo}"

# Wrong — {{}} in HTTP header (won't resolve)
http:
  headers:
    Authorization: "Bearer {{API_TOKEN}}"

# ✓ Correct — each syntax in its proper place
http:
  headers:
    Authorization: "Bearer ${API_TOKEN}"  # env var injection
default_tool_approvals:
  - tool_name: delete_repository
    message: "Delete repository: {{args.repo}}"  # tool argument
```

### ❌ Pre-filling secrets in env_spec
```yaml
# Wrong — secret value in YAML (never do this)
env_spec:
  data:
    GITHUB_TOKEN:
      value: "ghp_realtoken123abc"
      is_secret: true

# ✓ Correct — schema only, value provided at runtime
env_spec:
  data:
    GITHUB_TOKEN:
      description: "GitHub PAT with repo scope"
      is_secret: true
```

### ❌ Typos in tool_name (silently ignored — dangerous)
```yaml
# Wrong — typo silently disables approval policy
default_tool_approvals:
  - tool_name: delet_repository    # typo: missing 'e'
    message: "Delete repository: {{args.repo}}"

default_enabled_tools:
  - searchCode           # wrong — should be search_code?
  - GetFileContents      # wrong — should be get_file_contents?
```
Tool names must be verified from `stigmer discover mcp-server <slug>` or `status.discovered_capabilities`. Never guess tool names — they are case-sensitive and typos are silently ignored.

### ❌ Setting status fields in YAML
```yaml
# Wrong
status:
  validation_state: valid
  discovered_capabilities:
    tools: [...]

# ✓ Correct — omit entirely or leave as {}
# (do not set status at all)
```

### ❌ Slug format violations
```yaml
# Wrong
slug: GitHub             # uppercase not allowed
slug: github_mcp         # underscores not allowed
slug: 123-github         # must start with letter
slug: GitHub-MCP-Server  # mixed case not allowed

# ✓ Correct
slug: github
slug: github-mcp
slug: my-internal-db-v2
```

### ❌ Missing metadata.org in cloud mode
```yaml
# Wrong in cloud mode (OK in local mode where it defaults to "local")
metadata:
  name: github

# ✓ Correct for cloud
metadata:
  name: github
  org: acme-corp
```

---

## Tool Name Verification Workflow

Always follow this workflow when writing `default_enabled_tools` or `default_tool_approvals`:

```bash
# 1. Apply the McpServer (even with empty tool lists)
stigmer mcp-server apply mcpserver.yaml

# 2. Run discovery — connects to server and caches its tool list
stigmer discover mcp-server <slug>

# 3. Get the authoritative tool names
stigmer mcp-server get <slug> --output yaml
# Look at: status.discovered_capabilities.tools[*].name

# 4. Copy names exactly into default_enabled_tools and tool_name fields
# 5. Re-apply with the verified tool names
stigmer mcp-server apply mcpserver.yaml
```

### Finding Valid `{{args.field}}` Placeholders

After discovery, inspect `status.discovered_capabilities.tools[*].input_schema.properties` to see which argument names are valid for approval messages:

```yaml
# Tool's input_schema.properties from discovered_capabilities:
#   repo: {type: string}
#   title: {type: string}
#   head: {type: string}

# Valid approval message for that tool:
message: "Create PR '{{args.title}}' in {{args.repo}} from {{args.head}}"
```

---

## Checklist for Marketplace / Public Servers

Additional requirements for `visibility: visibility_public`:

- [ ] `spec.env_spec` descriptions are detailed enough for external users — include required token scopes and format
- [ ] `metadata.annotations` include `docs-url` pointing to the upstream MCP server documentation
- [ ] `spec.icon_url` is a publicly accessible, stable URL
- [ ] `spec.description` clearly explains what the server does and its primary use cases
- [ ] `metadata.tags` and `spec.tags` are accurate for marketplace discoverability
