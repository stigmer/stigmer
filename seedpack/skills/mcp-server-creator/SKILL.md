---
name: mcp-server-creator
description: >
  Create, validate, and explain Stigmer McpServer YAML resources conforming to the
  agentic.stigmer.ai/v1 API. Use this skill whenever a user wants to:
  (1) create a new McpServer YAML for any external system (GitHub, Slack, databases,
  web services, custom tools), (2) configure tool approval policies (human-in-the-loop),
  (3) declare credential requirements via env_spec, (4) choose between stdio (subprocess)
  and http (remote service) transport, (5) understand how agents reference McpServers via
  mcp_server_usages, (6) validate or fix an existing McpServer YAML, or (7) publish an
  McpServer to the marketplace.
---

# McpServer Creator

## What is a McpServer?

An McpServer is a **reusable, versioned YAML resource** that declares how an agent connects to an external system via the Model Context Protocol. It captures: the transport (stdio subprocess or HTTP endpoint), the credential schema (env_spec), the default tool set (default_enabled_tools), and approval policies for dangerous operations (default_tool_approvals).

Key principle: the McpServer contains **no secrets** — only the schema of what credentials are needed. Actual values are provided at runtime via AgentInstance's environment binding. One McpServer definition can be referenced by any number of agents.

**Platform lifecycle:**
```
McpServer (template) → Agent (references it) → AgentInstance (binds credentials) → AgentExecution (runner starts it)
```

---

## Step 1: Gather Intent

Before writing any YAML, ask:

1. **What system does this connect to?** (GitHub, Slack, PostgreSQL, a custom HTTP service, etc.)
2. **How does it run?** — Is it a CLI tool you start locally (→ `stdio`), or an already-running remote service (→ `http`)?
3. **What credentials does it need?** List each env var, whether it's a secret, and the required format/permissions.
4. **Which tools should be on by default?** If the server has destructive tools (delete, drop, send), should they be excluded from defaults?
5. **Which tools should require user approval?** Anything that modifies production state, sends messages, or deletes resources.
6. **Is it private or public?** Private = org only. Public = marketplace, any org can reference it.

If the user has already described the system, proceed directly to authoring. Only ask for missing critical information.

---

## Step 2: Choose Server Type

Exactly one of `stdio` or `http` is required. **When in doubt, choose `stdio`.**

| Situation | Use |
|---|---|
| Node.js `npx` package | `stdio` |
| Python module (`python -m ...`) | `stdio` |
| Go binary or custom executable | `stdio` |
| Remote managed/hosted MCP service | `http` |
| Server behind API gateway | `http` |
| Shared single instance across many agents | `http` |

**stdio config:**
```yaml
spec:
  stdio:
    command: npx                                        # executable on PATH or absolute path
    args: ["-y", "@modelcontextprotocol/server-github"] # ordered arguments
    working_dir: /opt/mcp                               # optional — use absolute paths only
```

**http config:**
```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"                   # required — valid HTTP/HTTPS URL
    headers:
      Authorization: "Bearer ${API_TOKEN}"              # ${VAR_NAME} for env var injection
    timeout_seconds: 60                                 # optional — 0-300, default 30
```

> **Syntax distinction — do not mix these up:**
> - `${VAR_NAME}` — used only in HTTP `headers` and `query_params` → resolved from environment
> - `{{args.field}}` — used only in approval `message` fields → resolved from tool call arguments

---

## Step 3: Declare env_spec (Credential Contract)

Declare every environment variable the MCP server needs. Values stay empty for secrets.

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true          # encrypted at rest, redacted in logs — NEVER pre-fill
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false         # may include a default value
```

Rules:
- `is_secret: true` → never include a `value`. Values are injected via AgentInstance at runtime.
- `is_secret: false` → may include a non-sensitive default `value`.
- Descriptions must be precise: include required token scopes, URL formats, and example values.

---

## Step 4: Configure Tool Access

### Default Enabled Tools (the ceiling for all agents)

Empty = all tools. Non-empty = only listed tools are available to any agent — agents cannot expand beyond this list.

```yaml
spec:
  default_enabled_tools:
    - search_code
    - get_file_contents
    - list_issues
    - create_pull_request
    # delete_repository intentionally excluded — too destructive for platform defaults
```

> **Critical:** Tool names must be exact and case-sensitive. Never guess — always verify via capability discovery (see Step 6). A wrong tool name is silently ignored.

### Default Tool Approvals (human-in-the-loop defaults)

Mark operations that should require user approval before execution for **all** agents using this server.

```yaml
spec:
  default_tool_approvals:
    - tool_name: merge_pull_request
      message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
    - tool_name: drop_table
      message: "Drop table {{args.table_name}} in {{args.database}}"
```

Guidelines for approval messages:
- Use `{{args.field_name}}` placeholders — replaced with actual argument values at call time
- Use action verbs: "Delete", "Merge", "Send", "Drop", "Create"
- Stay under ~100 characters for clean UI display
- If `message` is empty, the system generates: `"Execute tool: {tool_name}"`

Common tools that warrant approval: `delete_*`, `drop_*`, `merge_*`, `force_push`, `send_email`, `post_message`, `archive_*`, `execute_sql` (for DML/DDL).

---

## Step 5: Build the Complete YAML

Use this skeleton — remove optional fields that aren't needed:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: <human-readable-name>                 # required
  org: <STIGMER_ORG_ID>                       # read from STIGMER_ORG_ID env var
  slug: <url-friendly-slug>                   # optional — auto-derived from name
  visibility: visibility_private              # optional — visibility_public for marketplace
  labels:                                     # optional
    category: <vcs|database|communication|...>
  tags:                                       # optional
    - <tag1>
    - <tag2>
spec:
  description: "<what it does and primary use cases>"   # strongly recommended
  icon_url: "<public image URL>"                        # optional
  # --- EXACTLY ONE of stdio or http ---
  stdio:
    command: <executable>
    args: [<arg1>, <arg2>]
  # http:
  #   url: "https://..."
  #   headers:
  #     Authorization: "Bearer ${TOKEN_VAR}"
  #   timeout_seconds: 30
  # --- end server_type ---
  default_enabled_tools:                      # optional; empty = all tools
    - <tool_name_1>
    - <tool_name_2>
  default_tool_approvals:                     # optional
    - tool_name: <exact_tool_name>
      message: "<Action> {{args.field}}: description"
  env_spec:                                   # optional but strongly recommended
    data:
      <ENV_VAR_NAME>:
        description: "<precise description with scopes/format>"
        is_secret: <true|false>
# DO NOT include status — it is system-managed
```

For complete production examples, see `references/examples.md`.

---

## Step 6: Validate Before Presenting

Run through the full checklist in `references/validation-checklist.md` before presenting the YAML. Key items:

**Structure:**
- `apiVersion: agentic.stigmer.ai/v1` (exact)
- `kind: McpServer` (exact PascalCase)
- Exactly one of `stdio` or `http` — not both, not neither
- No `status` fields

**Fields:**
- Slug format: `^[a-z][a-z0-9-]*$`
- HTTP `url` is a valid HTTP/HTTPS URL
- `timeout_seconds` in range 0–300
- No secrets pre-filled in `env_spec`
- `${VAR_NAME}` only in HTTP headers/params; `{{args.field}}` only in messages

**Tool names (if specified):**
- Acknowledge that tool names in `default_enabled_tools` and `default_tool_approvals` must be verified post-apply:
  ```bash
  stigmer mcp-server apply mcpserver.yaml
  stigmer discover mcp-server <slug>
  stigmer mcp-server get <slug> --output yaml
  # Copy tool names from status.discovered_capabilities.tools[*].name
  stigmer mcp-server apply mcpserver.yaml   # re-apply with verified names
  ```
- If user has already discovered tools, use those exact names.
- If user has not yet discovered, include best-effort names AND note they must be verified.

---

## Step 7: Explain Agent Integration

After delivering the McpServer YAML, always explain how agents reference it. Read `references/agent-integration.md` for the complete picture. The key points:

```yaml
# In an Agent's spec.mcp_server_usages:
mcp_server_usages:
  - mcp_server_ref:
      org: <STIGMER_ORG_ID>   # matches McpServer metadata.org
      kind: mcp_server      # snake_case in ApiResourceReference (not McpServer)
      slug: github          # matches McpServer metadata.slug
    enabled_tools:          # optional — subset of McpServer's default_enabled_tools
      - search_code
      - get_file_contents
    tool_approval_overrides:   # optional — per-agent approval customization
      - tool_name: create_pull_request
        requires_approval: true
        message: "Create PR in {{args.repo}}: {{args.title}}"
      - tool_name: merge_pull_request
        requires_approval: false    # this trusted agent can merge without approval
```

**Approval policy precedence (highest wins):**
1. `AgentExecution.auto_approve_all: true` — runtime bypass, all tools run without approval
2. `Agent.mcp_server_usages[*].tool_approval_overrides` — per-agent customization
3. `McpServer.default_tool_approvals` — platform defaults (this YAML)

**Tool availability (only restriction, never expansion):**
- Agents can only use a subset of `McpServer.default_enabled_tools`
- Sub-agents can only use a subset of their parent agent's tools

---

## Reference Files

Load these when needed — do not load all at once:

| File | When to Load |
|---|---|
| `references/schema.md` | Full field reference for any spec field, metadata, status, or CLI commands |
| `references/examples.md` | Complete production-ready YAML examples (minimal through marketplace-ready) |
| `references/validation-checklist.md` | Pre-apply checklist and detailed pitfall descriptions |
| `references/agent-integration.md` | Full McpServerUsage fields, tool restriction chain, sub-agent access, approval overrides |
