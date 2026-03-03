# What is an MCP Server?

## One-Sentence Positioning

**An MCP Server is a portable, versioned, declarative definition of a tool integration—the same way a Docker image is a portable, versioned definition of a container.**

---

## Executive Summary

An MCP Server is a Stigmer API resource that declares how an agent connects to an external system and which tools that system exposes. It is a YAML document that captures the connection configuration (command to run or URL to call), the credential requirements, the default set of tools agents are allowed to use, and the approval policies that gate sensitive operations.

The MCP Server is the *integration template*—the wiring blueprint. It does not run on its own. When an agent references an MCP server, Stigmer's agent runner resolves the connection details at execution time, injects secrets from the AgentInstance's environment binding, and starts the server process or connects to the remote service.

MCP Servers are versioned, shareable, and reusable across many agents. A platform team can publish a GitHub MCP server to the marketplace once, and every agent in the organization references that single definition. When the platform team updates the tool list or tightens the approval policy, every agent picks up the change—no code changes required.

---

## The Problem MCP Servers Solve

### Tool Integrations Are Built the Wrong Way

Most teams wire tools into agents by hardcoding connection details into application code:

**Typical Python approach:**

```python
import subprocess

github_server = StdioServerParameters(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-github"],
    env={"GITHUB_TOKEN": os.environ["GITHUB_TOKEN"]},
)

agent = create_agent(
    tools=[github_server, slack_server, postgres_server],
    system_prompt="You are a code review assistant...",
)
```

This works for a single developer. It breaks down at team scale.

**What goes wrong:**

- The server command and environment variables are scattered across Python files. There is no history of how the configuration evolved, no way to roll back, no diff when a teammate changes the command or adds a new environment variable.
- Every agent that needs GitHub tools copies the same connection block. If the GitHub MCP server package releases a new version, you update it in every agent separately.
- There is no standard way to declare which tools are safe by default and which require human approval. Each team invents its own approval mechanism—or skips it entirely.
- Credentials are passed as raw environment variables in code. There is no declaration of what a server needs, so onboarding a new team member means reading the source and guessing which tokens to set.
- Sharing the integration with another team means sending them a code snippet. If you improve it, they never get the update.

### The Hidden Cost of This Approach

This creates compounding problems over time:

- **No versioning**: Tool configuration changes have no audit trail. You cannot answer "what version of the GitHub MCP server was the agent using when it created that PR six months ago?"
- **No reuse**: Every team configures the same tools from scratch. There is no library of MCP servers the way there is a library of Docker images.
- **No standard approval model**: Destructive operations—merging PRs, deleting repositories, dropping database tables—have no consistent gate. Teams bolt on approval logic ad hoc, or forget it entirely.
- **No credential contract**: The `env_spec` is implicit. New team members and automated systems cannot discover what credentials a server needs without reading application code.
- **No portability**: A tool integration written for local development cannot be promoted to production without touching application code.

---

## The Stigmer MCP Server

### One Structure. Any Agent. Any Scale.

Stigmer gives MCP server integrations the same treatment Kubernetes gave to workloads: a declarative API resource with a standard structure, versioning built in, and runtime decoupled from definition.

**The same MCP server YAML works for any agent:**

```bash
# Apply the integration template
stigmer mcp-server apply github.yaml

# Run discovery to populate tool metadata
stigmer discover mcp-server github

# Any agent can now reference it by org/slug
stigmer apply -f code-reviewer.yaml
stigmer apply -f security-scanner.yaml
stigmer apply -f devops-bot.yaml
```

### What the YAML Looks Like

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
  visibility: visibility_public
  tags:
    - git
    - vcs
    - code-review
spec:
  description: "GitHub MCP server for repository operations and code management"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"

  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]

  default_enabled_tools:
    - search_code
    - get_file_contents
    - list_issues
    - create_issue
    - create_pull_request
    - get_pull_request
    - merge_pull_request

  default_tool_approvals:
    - tool_name: merge_pull_request
      message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
    - tool_name: force_push
      message: "Force push to {{args.branch}} on {{args.repo}}"

  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo, read:org, and admin:repo_hook scopes"
        is_secret: true
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false
```

Apply it. Discover it. Reference it from any agent.

---

## Architecture: Where MCP Servers Fit

An MCP Server is one of the four layers in Stigmer's agent resource stack.

```
McpServer ──► Agent ──► AgentInstance ──► AgentExecution
```

| Layer | Analogy | What It Does |
|---|---|---|
| **McpServer** | Docker image | Declares how to connect to an external system and what tools it exposes. Versioned template. |
| **Agent** | Application spec | References one or more MCP servers and restricts which tools each agent may use. |
| **AgentInstance** | Running container | Binds credentials and environment values to the agent at runtime. Secrets live here, not in the McpServer. |
| **AgentExecution** | `docker run` | A single invocation. The runner resolves the MCP server config, injects secrets, and starts the tool server. |

**Why this separation matters:**

The McpServer declares *what* credentials are required (`env_spec`)—not their values. The AgentInstance provides the actual values at runtime. This means a single McpServer definition can be used by a development AgentInstance (pointing at a sandbox GitHub org) and a production AgentInstance (pointing at the real org), with zero changes to the McpServer YAML.

---

## The Four Building Blocks of an MCP Server

### 1. Server Type (Connection)

Every MCP server has exactly one transport: `stdio` for subprocess-based servers, or `http` for remote services.

**Stdio** spawns a child process and communicates over stdin/stdout. This is the right choice for the vast majority of community MCP servers—Node.js packages, Python modules, and Go binaries that implement the MCP protocol:

```yaml
spec:
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

**HTTP** connects to an already-running service over HTTP POST and Server-Sent Events. Use this for managed or hosted MCP services, or servers shared across many concurrent agents:

```yaml
spec:
  http:
    url: "https://mcp.example.com/search/v1"
    headers:
      Authorization: "Bearer ${SEARCH_API_TOKEN}"
    timeout_seconds: 45
```

When in doubt, choose `stdio`. It covers nearly all community MCP servers.

### 2. Environment Spec (Credential Contract)

The `env_spec` declares what the server needs at runtime—without embedding actual secrets. It is a contract between the McpServer template and the AgentInstance that provides the values:

```yaml
spec:
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true       # value will be redacted in logs
      GITHUB_OWNER:
        description: "Default GitHub org or username (e.g., acme-corp)"
        is_secret: false      # value may appear in logs
```

This explicit contract eliminates guesswork. When a new team member sets up their AgentInstance, they can see exactly which credentials are required and what permissions each one needs.

### 3. Default Enabled Tools (Tool Gate)

The `default_enabled_tools` list sets a platform-level ceiling on which tools agents can use from this server. Any tool omitted from this list cannot be enabled by an agent—even if the underlying server supports it:

```yaml
spec:
  default_enabled_tools:
    - execute_query
    - list_tables
    - describe_table
    - list_schemas
    # execute_ddl and drop_table are intentionally omitted — too destructive for defaults
```

Agents can use any subset of the `default_enabled_tools` list. They cannot add tools beyond it. This gives the MCP server owner control over what any agent referencing this server can ever do.

### 4. Default Tool Approvals (Approval Policy)

The `default_tool_approvals` list defines which tools require human approval before the agent runner executes them. Approval policies form a three-layer chain:

```
McpServer.default_tool_approvals   (base — applies to all agents)
        ↓
Agent.tool_approval_overrides      (per-agent — can add or remove requirements)
        ↓
AgentExecution.auto_approve_all    (runtime bypass — for automated pipelines)
```

The approval message supports `{{args.field}}` templates that render actual tool arguments at call time, giving approvers meaningful context:

```yaml
spec:
  default_tool_approvals:
    - tool_name: merge_pull_request
      message: "Merge PR #{{args.pull_number}} in {{args.repo}}"
    - tool_name: post_message
      message: "Post to #{{args.channel_name}}: {{args.text}}"
    - tool_name: drop_table
      message: "Drop table '{{args.table_name}}' in database {{args.database}}"
```

---

## Capability Discovery

After applying an MCP server, Stigmer does not automatically know which tools it exposes. Discovery is the process of connecting to the server, querying its tool list, and persisting that metadata to the McpServer's `status.discovered_capabilities` field.

There are three discovery sources:

| Source | How It Works | When It Runs |
|---|---|---|
| **Seedpack** | Built-in definitions for well-known servers (GitHub, Slack, etc.) | On first apply of a known server |
| **CLI** | `stigmer discover mcp-server <slug>` connects locally and pushes metadata | On demand — run this after applying a new server |
| **Agent runner** | Caches tool names during execution (future) | Automatically at runtime |

**Discovery workflow:**

```bash
# 1. Apply the McpServer
stigmer mcp-server apply github.yaml

# 2. Discover its tools
stigmer discover mcp-server github

# 3. See what was discovered
stigmer mcp-server get github
# status.discovered_capabilities.tools now lists all tool names and descriptions
```

Once discovered, tool names appear in the Stigmer UI and CLI. You can reference them confidently in `default_enabled_tools` and `default_tool_approvals` without guessing.

---

## How MCP Servers Are Versioned and Shared

### Versioning

Every time you apply an MCP server with a changed spec, Stigmer creates a new version. The version record contains:

- The full spec at that point in time
- Who made the change and when
- A reference to the previous version

This means you can always answer: "What tool list and approval policy was in effect when that agent ran last month's deployment?"

### Visibility and the Marketplace

MCP servers support two visibility levels:

```yaml
# Private — only your org can use it
metadata:
  name: internal-knowledge-base
  org: acme-corp
  visibility: visibility_private

# Public — any org can discover and reference it
metadata:
  name: github
  org: stigmer
  visibility: visibility_public
```

Public MCP servers appear in the Stigmer marketplace. Any organization can reference a public server by its `org/slug`. This is how the community publishes reusable tool integrations—the same way Docker Hub works for container images.

**Referencing a public MCP server from an agent:**

```yaml
# In an Agent spec
spec:
  mcp_server_usages:
    - mcp_server_ref:
        org: stigmer        # the publisher's org
        kind: mcp_server
        slug: github        # the server slug
      enabled_tools:
        - search_code
        - get_file_contents
        - create_pull_request
```

Your agents reference the marketplace server directly. When the publisher updates the approval policy or tool list, you pick up the change at your next version pin.

---

## How It Compares

| Without Stigmer MCP Servers | With Stigmer MCP Servers |
|---|---|
| Connection config scattered across Python/TypeScript files | Single versioned YAML, tracked in git |
| Credential requirements implicit—read the code to find out | `env_spec` makes requirements explicit with descriptions |
| Every agent copies the same tool configuration | One McpServer definition referenced by any number of agents |
| No standard tool gate—agents can call anything | `default_enabled_tools` sets a ceiling agents cannot exceed |
| Approval logic invented ad hoc per team | `default_tool_approvals` defines the baseline; agents extend it |
| No audit trail of which tool version ran which execution | Every execution linked to a versioned McpServer definition |
| Local dev integrations cannot promote to production cleanly | Same YAML, different AgentInstance—swap environment values |
| Sharing a tool integration means copying code | Reference a public server by `org/slug`; improvements propagate |

---

## Getting Started

```bash
# 1. Create a McpServer YAML
cat > github.yaml << 'EOF'
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: default
spec:
  description: "GitHub MCP server for repository operations"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo scope"
        is_secret: true
EOF

# 2. Apply it
stigmer mcp-server apply github.yaml

# 3. Discover its tools
stigmer discover mcp-server github

# 4. See what tools are available
stigmer mcp-server get github

# 5. Reference it from an agent
stigmer agent list   # then edit your agent YAML to add mcp_server_usages
```

---

## Further Reading

- [MCP Server YAML Schema Reference](../../apis/ai/stigmer/agentic/mcpserver/docs/mcpserver-resource-guide.md) — Complete field documentation
- [Server Types](../../apis/ai/stigmer/agentic/mcpserver/docs/server-types.md) — Stdio vs HTTP: when to use each
- [Tool Approval Policies](../../apis/ai/stigmer/agentic/mcpserver/docs/tool-approval-policies.md) — Three-layer approval chain and message templates
- [Capability Discovery](../../apis/ai/stigmer/agentic/mcpserver/docs/capability-discovery.md) — How tool names are discovered and persisted
- [Examples](../../apis/ai/stigmer/agentic/mcpserver/docs/examples.md) — Complete YAML examples from minimal to marketplace-ready
- [What is an Agent?](what-is-agent.md) — How agents reference and restrict MCP server access
