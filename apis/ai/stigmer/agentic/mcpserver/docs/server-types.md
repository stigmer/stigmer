# Server Types

McpServer supports two transport mechanisms for communicating with an MCP server process. Exactly one must be specified in `spec` — this is enforced by the proto (`oneof server_type` with `required` validation).

## Choosing a Transport

| | Stdio | HTTP |
|---|---|---|
| **How it runs** | Subprocess on the agent runner's host | Remote service over the network |
| **Where it runs** | **Local runners only** — sessions with `execution_target: local` (desktop app, `stigmer server`) | Everywhere — local runners and cloud-hosted sessions |
| **Communication** | stdin/stdout (JSON-RPC) | HTTP POST + Server-Sent Events |
| **Best for** | Tools that need your machine — local files, GUI apps, private-network services; local development | Managed/hosted MCP services; anything running on cloud sessions; servers shared across many concurrent agents |
| **Credential delivery** | Environment variables passed to the subprocess | Environment variable substitution in headers/params |
| **Startup cost** | New process per execution | No process startup — connects to existing service |
| **Examples** | `npx @modelcontextprotocol/server-github`, `python -m mcp_server_sqlite` | `https://mcp.example.com/v1`, internal services behind a reverse proxy |

Prefer `http` when the vendor offers a hosted MCP endpoint — it works on every execution target. Choose `stdio` when the tool must run on your own machine: stdio means "download a package and run it as a subprocess with your credentials in its environment", which is your trust decision on a local runner but is refused on Stigmer-managed cloud compute. Cloud-targeted sessions that reference a stdio server fail at execution create with a clear remediation.

---

## Stdio

Defined by `StdioServerConfig` in `ai/stigmer/agentic/mcpserver/v1/spec.proto`.

The agent runner spawns the MCP server as a child process and communicates over its stdin/stdout. Environment variables from the AgentInstance's environment binding are passed directly to the subprocess — this is the standard way credentials are injected.

**Local runners only.** Stdio servers run where the runner runs, so they are supported only on sessions executing on a local runner (`execution_target: local`). Cloud-hosted sessions refuse them at execution create time, and cloud runners refuse to spawn them as defense-in-depth. This includes the hybrid setup — control plane in Stigmer Cloud, runner on your machine — where stdio works normally.

### Fields

| Field | Required | Description |
|---|---|---|
| `command` | Yes | The executable to run. Can be a binary name (resolved via `PATH`) or an absolute path. Examples: `npx`, `python`, `node`, `./mcp-server`, `/usr/local/bin/my-server`. |
| `args` | No | Arguments passed to the command. Order matters. |
| `working_dir` | No | Working directory for the spawned process. Use absolute paths for reliability. If omitted, the process inherits the agent runner's working directory. |

### Configuration Examples

**Node.js MCP server via npx:**
```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

**Python MCP server module:**
```yaml
spec:
  stdio:
    command: python
    args: ["-m", "mcp_server_sqlite", "--db-path", "/data/db.sqlite"]
```

**Custom binary with working directory:**
```yaml
spec:
  stdio:
    command: ./mcp-server
    working_dir: /opt/my-mcp-server
    args: ["--config", "config.yaml"]
```

**Node.js server with explicit version pinning:**
```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github@1.2.3"]
```

### Credential Injection for Stdio

Environment variables are the standard mechanism for injecting credentials into stdio servers. Declare them in `env_spec` — the agent runner will populate them from the AgentInstance's environment before starting the process:

```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo scope"
        is_secret: true
```

The subprocess inherits the full environment including all resolved variables. The MCP server process reads `GITHUB_TOKEN` from its environment exactly as it would if run locally.

---

## HTTP

Defined by `HttpServerConfig` in `ai/stigmer/agentic/mcpserver/v1/spec.proto`.

The agent runner connects to a running HTTP service and communicates via HTTP POST requests and Server-Sent Events (SSE) for streaming responses. The service must already be running — the agent runner does not start it.

### Fields

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Base URL of the MCP endpoint. Must be a valid HTTP or HTTPS URL (validated by `buf.validate`). |
| `headers` | No | HTTP headers sent with every request. Values support `${VAR_NAME}` env var substitution. |
| `query_params` | No | Query parameters appended to the URL. Values support `${VAR_NAME}` env var substitution. |
| `timeout_seconds` | No | Request timeout in seconds. Applies to both connection and streaming. Range: 0–300. Default: 30 seconds if not specified. Set higher for servers that perform long-running operations. |

### Configuration Examples

**Minimal HTTP server:**
```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
```

**HTTP server with authentication header:**
```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
  env_spec:
    data:
      API_TOKEN:
        description: "API token for the MCP service"
        is_secret: true
```

**HTTP server with API versioning and tenant routing:**
```yaml
spec:
  http:
    url: "https://api.company.com/mcp"
    headers:
      Authorization: "Bearer ${SERVICE_TOKEN}"
      X-API-Version: "2024-01"
      X-Tenant-ID: "${TENANT_ID}"
    timeout_seconds: 60
  env_spec:
    data:
      SERVICE_TOKEN:
        description: "Service authentication token"
        is_secret: true
      TENANT_ID:
        description: "Tenant identifier for multi-tenant routing"
        is_secret: false
```

**HTTP server with query parameter authentication:**
```yaml
spec:
  http:
    url: "https://mcp.example.com/v1"
    query_params:
      api_key: "${API_KEY}"
      region: "${AWS_REGION}"
  env_spec:
    data:
      API_KEY:
        description: "API key for authentication"
        is_secret: true
      AWS_REGION:
        description: "AWS region for request routing"
        is_secret: false
```

### Environment Variable Interpolation

HTTP headers and query parameter values support `${VAR_NAME}` substitution. Placeholders are resolved at runtime from the AgentInstance's environment binding.

```yaml
headers:
  Authorization: "Bearer ${API_TOKEN}"    # Resolved to: "Bearer eyJhbGci..."
  X-Tenant-ID: "${TENANT_ID}"             # Resolved to: "acme-corp"
```

**Important distinctions:**

| Syntax | Used In | Resolved By | Example |
|---|---|---|---|
| `${VAR_NAME}` | HTTP headers and query params | Agent runner, from environment binding | `"Bearer ${API_TOKEN}"` |
| `{{args.field}}` | Tool approval messages | Approval engine, from tool call arguments | `"Delete repo: {{args.repo}}"` |

These two syntaxes serve different purposes and must not be confused. `${VAR_NAME}` is for environment variable injection into the HTTP connection configuration. `{{args.field}}` is for rendering contextual approval messages from tool arguments at call time. See [tool-approval-policies.md](tool-approval-policies.md) for `{{args.field}}` documentation.

### Timeout Guidance

The `timeout_seconds` field governs both the initial connection and the full response duration including streaming. The valid range is 0–300 seconds.

| Use Case | Suggested Timeout |
|---|---|
| Simple lookups and queries | 30 seconds (default) |
| Operations that may trigger background work | 60–120 seconds |
| Long-running data processing or export | 180–300 seconds |

Setting `timeout_seconds: 0` is treated as unspecified — the agent runner will apply its default (30 seconds). To allow very long operations, set explicitly to the expected maximum duration.

---

## Related Documentation

- [mcpserver-resource-guide.md](mcpserver-resource-guide.md) — Full schema reference and CLI commands
- [capability-discovery.md](capability-discovery.md) — How tool names are discovered for both server types
- [examples.md](examples.md) — Complete YAML examples for both server types
- [validation-checklist.md](validation-checklist.md) — Common pitfalls for server type configuration
