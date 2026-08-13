# Capability Discovery

How McpServers report their tools and resource templates, the three sources of discovered capabilities, and why discovery matters for authoring agents and approval policies.

## What Are Discovered Capabilities?

Discovered capabilities are a **point-in-time snapshot** of the tools and resource templates an MCP server reports via its `tools/list` and `resources/templates/list` protocol methods. They are stored in `status.discovered_capabilities` and serve two critical purposes:

1. **Verification** — confirms the server is functional and what it actually provides, not just what its YAML spec declares.
2. **Authoring support** — gives you the exact tool names needed to populate `default_enabled_tools`, `default_tool_approvals`, and agent `enabled_tools` / `tool_approval_overrides`. Tool names must match exactly (case-sensitive): unknown names in `enabled_tools` / `default_enabled_tools` are rejected at apply time once the server has discovered capabilities, while approval-policy names (`default_tool_approvals`, `tool_approval_overrides`) are silently ignored.

Discovered capabilities are **not live** — they do not update automatically when the MCP server changes. Discovery is an explicit action.

## Three Discovery Sources

Defined by `DiscoverySource` in `ai/stigmer/agentic/mcpserver/v1/status.proto`.

| Source | Value | How Populated |
|---|---|---|
| `seedpack` | Built-in servers with known, stable tool sets | Populated automatically during platform bootstrap for first-party servers (e.g., `stigmer-mcp-server`). No action required. |
| `cli` | Developer-initiated discovery | Run `stigmer discover mcp-server <slug>` locally. The CLI connects to the server, queries its tools, and pushes the results to the platform. |
| `agent_runner` | Runtime cache refresh (future) | Reserved for future agent-runner-initiated discovery during execution. Not yet implemented. |

For most McpServers, discovery is done via the CLI.

## DiscoveredCapabilities Structure

Defined in `ai/stigmer/agentic/mcpserver/v1/status.proto`.

> **CRITICAL — Tools vs Resource Templates**: `discovered_capabilities` contains two separate lists that serve fundamentally different purposes:
>
> - **`tools`** — callable actions (e.g., `search_code`, `create_pr`). These are the **only** names valid for use in `default_enabled_tools`, agent `enabled_tools`, and `tool_approval_overrides`.
> - **`resource_templates`** — read-only data endpoints accessed by URI (e.g., `cloud-resource-schema://{kind}`). These are **not** callable tools. Resource template names must **never** appear in `enabled_tools` or `default_enabled_tools` — once the server has discovered capabilities, apply rejects them with a targeted error; before the first discovery, the runner warns and ignores them at execution.

```yaml
status:
  discovered_capabilities:
    last_discovered_at: "2024-01-15T10:30:00Z"
    discovered_by: cli
    tools:
      - name: search_code
        description: "Search across GitHub repositories"
        input_schema:
          type: object
          properties:
            query:
              type: string
              description: "Search query string"
            repo:
              type: string
              description: "Repository to search (org/name)"
          required: [query]
      - name: create_pull_request
        description: "Create a pull request"
        input_schema:
          type: object
          properties:
            repo:
              type: string
            title:
              type: string
            body:
              type: string
            head:
              type: string
            base:
              type: string
          required: [repo, title, head, base]
    resource_templates:
      - uri_template: "github://repos/{owner}/{repo}/contents/{path}"
        name: "github_file"
        description: "Contents of a file in a GitHub repository"
        mime_type: "text/plain"
```

### DiscoveredTool Fields

| Field | Description |
|---|---|
| `name` | Unique tool name within the server (case-sensitive). This is the exact string to use in `default_enabled_tools`, `default_tool_approvals.tool_name`, and agent `enabled_tools` / `tool_approval_overrides.tool_name`. |
| `description` | Human-readable explanation of what the tool does. Shown in the UI and used by agents to decide when to invoke the tool. |
| `input_schema` | JSON Schema describing the tool's input parameters. Stored as a structured object (not a string). Reveals which `{{args.field}}` placeholders are valid in approval message templates. |

### DiscoveredResourceTemplate Fields

| Field | Description |
|---|---|
| `uri_template` | URI template using RFC 6570 placeholders (e.g., `github://repos/{owner}/{repo}/contents/{path}`). |
| `name` | Identifier for this resource template. |
| `description` | Human-readable description of what the resource represents. |
| `mime_type` | MIME type of the resource content (e.g., `application/json`, `text/plain`). |

## CLI Discovery Workflow

Run `stigmer discover mcp-server` locally whenever you want to refresh discovered capabilities. This is the recommended step after creating or updating an McpServer.

```bash
# Step 1: Apply or create the McpServer definition
stigmer apply -f mcpserver.yaml

# Step 2: Run discovery — connects to the server locally and caches results
stigmer discover mcp-server github

# Step 3: Inspect the discovered tools
stigmer get mcp-server github --output yaml
# Look at status.discovered_capabilities
```

### What the CLI Does

1. Resolves the McpServer by slug, fetching its system ID.
2. Reads the `spec.stdio` or `spec.http` configuration.
3. Starts or connects to the MCP server locally using the configuration.
4. Calls `tools/list` and `resources/templates/list` on the running server.
5. Pushes the results to the platform via the `updateDiscoveredCapabilities` RPC.
6. The platform stores the snapshot in `status.discovered_capabilities`.

The CLI does **not** push discovery results in real time during execution — it's an explicit, on-demand operation.

### Privacy Model

For stdio servers, the MCP server process runs on the **developer's local machine** during discovery. Credentials (environment variables like `GITHUB_TOKEN`) are resolved from the local environment and passed to the subprocess — they never leave the local environment and are never sent to the platform. Only the tool metadata (names, descriptions, input schemas) is transmitted.

This means:
- Secrets stay local.
- You can safely run discovery on any machine with the right credentials.
- The platform only receives structural information about what the server can do.

For HTTP servers, the CLI connects to the remote URL from the developer's machine. Credentials in headers/params are resolved locally and used only for the connection.

## When to Re-Run Discovery

Discovery is a snapshot, not a live view. Re-run it when:

- You've applied a new McpServer definition for the first time.
- The MCP server has been updated and may expose new or changed tools.
- You're writing `default_tool_approvals` or `default_enabled_tools` and need to verify exact tool names.
- A tool approval policy was silently not applied and you suspect a tool name mismatch.

```bash
# Re-run discovery after updating the server package
stigmer discover mcp-server github

# Confirm the tools list is current
stigmer get mcp-server github --output yaml
```

## Using Discovered Tool Names

The `discovered_capabilities.tools[*].name` values are the **authoritative source** for tool names. Copy them exactly when writing.

> **Warning**: Only names from `discovered_capabilities.tools` are valid for `enabled_tools` and `default_enabled_tools`. Names from `discovered_capabilities.resource_templates` must **never** be used in these fields — resource templates are data endpoints, not callable tools. Once the server has discovered capabilities, apply rejects a resource-template name (or any unknown name) with `INVALID_ARGUMENT`; before the first discovery, the runner warns and ignores such entries at execution.

**`spec.default_enabled_tools`:**
```yaml
spec:
  default_enabled_tools:
    - search_code           # from status.discovered_capabilities.tools[0].name
    - get_file_contents     # from status.discovered_capabilities.tools[1].name
    - create_pull_request   # from status.discovered_capabilities.tools[2].name
```

**`spec.default_tool_approvals`:**
```yaml
spec:
  default_tool_approvals:
    - tool_name: delete_repository    # exact name from discovered tools
      message: "Delete repository: {{args.repo}}"
```

**Agent `enabled_tools` and `tool_approval_overrides`** in Agent YAML also use these same names. See [Agent docs: mcp-server-integration.md](../agent/docs/mcp-server-integration.md).

### Discovering Valid `{{args.field}}` Placeholders

The `input_schema` of a discovered tool reveals which argument names are valid in approval message templates. Use the `properties` keys:

```yaml
# Tool's input_schema (from discovery):
input_schema:
  properties:
    repo:
      type: string
    title:
      type: string
    head:
      type: string

# Valid placeholders for this tool's approval message:
message: "Create PR '{{args.title}}' in {{args.repo}} from {{args.head}}"
```

## Seedpack-Bootstrapped Servers

First-party servers (like `stigmer-mcp-server`) have their capabilities pre-populated during platform bootstrap from the seedpack. You do not need to run discovery for these servers — their tool sets are known and stable.

```bash
# Check capabilities for the built-in stigmer MCP server
stigmer get mcp-server stigmer-mcp-server --output yaml
# status.discovered_capabilities.discovered_by: seedpack
```

## Related Documentation

- [mcpserver-resource-guide.md](mcpserver-resource-guide.md) — `status.discovered_capabilities` field reference
- [tool-approval-policies.md](tool-approval-policies.md) — Using discovered tool names in approval policies
- [validation-checklist.md](validation-checklist.md) — Pitfalls from using unverified tool names
- [examples.md](examples.md) — Seeing `discovered_capabilities` in context
