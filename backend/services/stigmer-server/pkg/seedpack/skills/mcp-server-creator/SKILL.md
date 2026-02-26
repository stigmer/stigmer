---
name: mcp-server-creator
description: >
  Create and validate production-quality Stigmer McpServer YAML files conforming to the
  agentic.stigmer.ai/v1 API. Use this skill when a user wants to define, configure, or
  update an McpServer resource — including choosing the right server type (stdio vs http),
  declaring environment variables, configuring default tool gates, setting approval policies,
  and understanding how agents reference the resulting resource.
---

# McpServer Creator

Create valid `agentic.stigmer.ai/v1` McpServer YAML files. Follow this six-step workflow in order.

## Reference Files

Load these as needed — do not load all at once:

- **`references/schema.md`** — complete field reference for all metadata, spec, stdio, http, env_spec, and approval fields
- **`references/examples.md`** — seven annotated, production-ready YAML examples (minimal → marketplace)
- **`references/agent-integration.md`** — how agents reference McpServers via `mcp_server_usages`
- **`references/validation-checklist.md`** — pre-apply checklist and nine common pitfalls with corrections

---

## Workflow

### Step 1 — Understand the MCP Server

Before writing any YAML, gather the following from the user. Ask in a single focused message rather than one question at a time:

1. **What external system** does this server connect to? (GitHub, Slack, a database, an internal API…)
2. **How is it started?** — a CLI tool/package (npx, python, binary) → `stdio`; a running remote HTTP service → `http`
3. **What credentials does it need?** — API tokens, connection strings, tenant IDs; which are secret?
4. **What tools should be available by default?** — safe read operations vs. dangerous write/delete operations
5. **Which tools need user approval?** — destructive or sensitive operations
6. **Who owns it?** — `local` for local development, or an org slug for cloud/team use
7. **Is it public?** — marketplace publishing requires `visibility_public`

> If the user has already provided enough context (e.g., "Create an McpServer for the GitHub npx package"), proceed directly — don't re-ask what you already know.

---

### Step 2 — Choose the Server Type

**Choose `stdio`** (default for most MCP servers) when:
- The server runs as a subprocess: `npx`, `python -m`, a Go/Rust binary, or any CLI tool
- The server comes from the MCP community ecosystem

**Choose `http`** when:
- The server is a managed/hosted HTTP service already running somewhere
- Multiple agents need to share a single server instance
- The server is behind an API gateway

When in doubt, choose `stdio`. Read `references/schema.md` for full field details on both types.

---

### Step 3 — Draft the YAML

Read `references/schema.md` for the complete field reference. Use `references/examples.md` as a starting point — pick the example closest to the user's use case and adapt it.

**Mandatory fields (always include):**
```yaml
apiVersion: agentic.stigmer.ai/v1   # exact — not stigmer.ai/v1, not agentic/v1
kind: McpServer                      # PascalCase — not mcpserver, not mcp_server
metadata:
  name: <human-readable name>
  org: local                         # or real org slug in cloud mode
spec:
  description: "<what this server does and its primary use cases>"
  stdio:                             # or http: — exactly one, never both
    command: <executable>
    args: [...]
```

**Key authoring rules:**
- `env_spec` declares schema only — **never pre-fill secret values**
- `default_enabled_tools` and `default_tool_approvals` tool names must be **verified**, not guessed (Step 5)
- `status` must be **omitted** or left as `status: {}` — never set by users
- `metadata.slug` auto-generates from `name` if omitted; if set, must be `^[a-z][a-z0-9-]*$`

---

### Step 4 — Configure Tool Gates and Approval Policies

**`default_enabled_tools`** — determine the safe default tool set:
- Include read/search/list tools that are always appropriate
- Exclude destructive tools (delete, drop, force-push, send) from defaults
- Empty list = all tools enabled (acceptable for low-risk servers)

**`default_tool_approvals`** — require approval for destructive or sensitive operations:
- Any tool that deletes, modifies state irreversibly, sends external communications, or grants access
- Write informative messages: `"Delete repository: {{args.repo}}"` not `"Confirm action"`
- Use `{{args.field_name}}` (not `${field_name}`) — resolved from tool call arguments at invocation time
- Keep messages under 100 characters

> Tool names for both fields must be verified in Step 5. Write them as best-guess placeholders now, then correct after discovery.

---

### Step 5 — Verify Tool Names via Discovery

Tool names in `default_enabled_tools` and `default_tool_approvals` must match **exactly** what the server reports via `tools/list`. Mismatches are **silently ignored** — no error, no approval enforced.

**Verification workflow:**
```bash
# 1. Apply the draft
stigmer mcp-server apply mcpserver.yaml

# 2. Run discovery (connects to the server locally, caches tool metadata)
stigmer discover mcp-server <slug>

# 3. Inspect discovered tools — copy names from here
stigmer mcp-server get <slug> --output yaml
# → status.discovered_capabilities.tools[*].name
```

After discovery, correct any tool names in the YAML. Also use `input_schema.properties` keys from the discovered tools to verify `{{args.field}}` placeholder names in approval messages.

> If the user is not yet ready to run discovery (e.g., designing ahead of installation), note which tool names are unverified and instruct them to run this workflow before using the server in production.

---

### Step 6 — Validate and Present

Before presenting the final YAML, run through the checklist mentally (or read `references/validation-checklist.md` for the full list and nine common pitfalls):

**Critical checks:**
- [ ] `apiVersion: agentic.stigmer.ai/v1` — exact string
- [ ] `kind: McpServer` — PascalCase
- [ ] Exactly one of `stdio` or `http` — never both, never neither
- [ ] No secret values in `env_spec` (no `value:` for `is_secret: true` entries)
- [ ] `${VAR_NAME}` only in HTTP headers/params; `{{args.field}}` only in approval messages
- [ ] Tool names verified (or flagged as unverified pending discovery)
- [ ] `status` omitted or `status: {}`

Present the YAML as a complete, copy-paste-ready block with a brief explanation of key choices made (server type rationale, which tools were gated and why, any caveats about unverified tool names).

---

### Step 7 — Explain Agent Integration

After presenting the McpServer YAML, always explain how agents reference it. Read `references/agent-integration.md` and provide a minimal example tailored to their server:

```yaml
# In an Agent spec — referencing the McpServer you just created
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: local          # matches McpServer metadata.org
        kind: mcp_server    # snake_case here (not McpServer)
        slug: <slug>        # matches McpServer metadata.slug
      enabled_tools:        # optional: restrict to a subset of default_enabled_tools
        - <tool_name>
```

Highlight: agents can only **restrict** tools further (never expand beyond McpServer defaults), and can **override** approval policies per-agent via `tool_approval_overrides`.
