# Validation Checklist

Run through this checklist before presenting any McpServer YAML. Every item must pass.

## Required Fields

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1`
- [ ] `kind` is exactly `McpServer` (PascalCase — not `mcpserver`, `Mcpserver`, `mcp_server`, `MCP_SERVER`)
- [ ] `metadata.name` is present
- [ ] Exactly one of `spec.stdio` or `spec.http` is specified (proto `oneof` with `required` — omitting both or both present fails)
- [ ] `spec.description` is present and explains the server's purpose

## Stdio Servers

- [ ] `spec.stdio.command` is present
- [ ] Command is a real executable (`npx`, `python`, `node`, `./binary`, etc.)
- [ ] `working_dir` uses absolute path if specified
- [ ] All required env vars declared in `env`

## HTTP Servers

- [ ] `spec.http.url` is a valid HTTP or HTTPS URL
- [ ] Every `${VAR_NAME}` in `headers` and `query_params` has a matching `env` entry
- [ ] `timeout_seconds` is in range 0–300 if specified

## Metadata

- [ ] `slug` (if specified) matches `^[a-z][a-z0-9-]*$`, 1–63 characters
- [ ] `org` is set (auto-resolved from context if omitted, but recommended to be explicit)
- [ ] `visibility` is intentional — only `visibility_public` for marketplace servers

## Environment Variables

- [ ] Every env var has `is_secret` correctly classified
- [ ] Secret values are NOT pre-filled
- [ ] Descriptions specify required permissions/format/scopes
- [ ] Variables with sensible defaults or non-critical features have `optional: true`

## Tool Names

- [ ] All names in `default_enabled_tools` are verified (not guessed)
- [ ] All `tool_name` in `default_tool_approvals` match exactly (case-sensitive)
- [ ] If tool names are unverified, include a note to run `stigmer discover mcp-server <slug>` after applying

## Placeholder Syntax

- [ ] HTTP headers/params use `${VAR_NAME}` (not `{{}}`)
- [ ] Approval messages use `{{args.field}}` (not `${}`)
- [ ] These two syntaxes are never mixed up

## Status

- [ ] No `status` fields set (system-managed — omit entirely or leave as `{}`)

## Common Pitfalls

### Wrong `kind` casing
```yaml
# WRONG                    # CORRECT
kind: mcpserver            kind: McpServer
kind: Mcpserver            kind: McpServer
kind: mcp_server           kind: McpServer
```

Note: In Agent `mcp_server_ref`, use `kind: mcp_server` (snake_case). In the McpServer resource itself, use `kind: McpServer` (PascalCase). Both are correct for their respective contexts.

### Wrong `apiVersion`
```yaml
# WRONG                         # CORRECT
apiVersion: stigmer.ai/v1       apiVersion: agentic.stigmer.ai/v1
apiVersion: agentic/v1          apiVersion: agentic.stigmer.ai/v1
apiVersion: v1                  apiVersion: agentic.stigmer.ai/v1
```

### Mixing placeholder syntaxes
```yaml
# WRONG — ${} in approval message
message: "Delete ${args.repo}"

# WRONG — {{}} in HTTP header
Authorization: "Bearer {{API_TOKEN}}"

# CORRECT
Authorization: "Bearer ${API_TOKEN}"     # env var in header
message: "Delete repository: {{args.repo}}"  # tool arg in approval
```

### Secret values in spec
```yaml
# WRONG
GITHUB_TOKEN:
  value: "ghp_realtoken123"    # Never put real secrets here
  is_secret: true

# CORRECT
GITHUB_TOKEN:
  description: "GitHub PAT with repo scope"
  is_secret: true
```

### Unverified tool names (silent failure)
Tool names in `default_tool_approvals` that don't match the server's `tools/list` are **silently ignored** — no error, no warning, no approval enforced. Always verify names via discovery or documentation.

### Slug format errors
```yaml
# WRONG
slug: GitHub             # uppercase
slug: github_mcp         # underscores
slug: 123-github         # starts with digit

# CORRECT
slug: github
slug: github-mcp
slug: my-db-server-v2
```
