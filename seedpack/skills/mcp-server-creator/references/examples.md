# McpServer YAML Examples

Annotated examples from minimal to marketplace-ready. All are valid and can be applied directly.

## Table of Contents
1. [Minimal stdio server](#minimal-stdio-server)
2. [stdio with credentials](#stdio-with-credentials)
3. [stdio with tool restrictions and approvals](#stdio-with-tool-restrictions-and-approvals)
4. [HTTP server with authentication](#http-server-with-authentication)
5. [HTTP multi-tenant service](#http-multi-tenant-service)
6. [Marketplace-ready public server](#marketplace-ready-public-server)

---

## Minimal stdio Server

Smallest valid McpServer — enough to reference from an agent immediately.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
spec:
  description: "GitHub MCP server for repository operations"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

**After applying:**
```bash
stigmer apply -f mcpserver.yaml
stigmer discover mcp-server github   # populate tool names
```

---

## stdio with Credentials

Standard pattern: declare required environment variables without values. Values are provided via AgentInstance at runtime.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
  tags:
    - git
    - vcs
spec:
  description: "GitHub MCP server for repository operations, code search, and PR management"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo and read:org scopes"
        is_secret: true       # encrypted at rest, redacted in logs
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false      # plaintext, visible in audit logs
```

---

## stdio with Tool Restrictions and Approvals

Database server: dangerous tools excluded from defaults, sensitive ops require approval.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: postgres
  org: acme-corp
  labels:
    category: database
  tags:
    - database
    - sql
    - postgresql
spec:
  description: "PostgreSQL MCP server for database queries and schema inspection"
  stdio:
    command: python
    args: ["-m", "mcp_server_postgres"]
  default_enabled_tools:
    - execute_query
    - list_tables
    - describe_table
    - list_schemas
    # execute_ddl and drop_table intentionally omitted — use default_tool_approvals if needed
  default_tool_approvals:
    - tool_name: execute_query
      message: "Execute SQL query on {{args.database}}: {{args.query}}"
  env_spec:
    data:
      POSTGRES_URL:
        description: "PostgreSQL connection URL (postgres://user:pass@host/dbname)"
        is_secret: true
```

**Complete GitHub example with approval policies:**

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
  labels:
    category: vcs
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
    - tool_name: add_collaborator
      message: "Add {{args.username}} as {{args.permission}} collaborator to {{args.repo}}"
    - tool_name: force_push
      message: "Force push to {{args.branch}} on {{args.repo}}"
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo, read:org, and admin:repo_hook scopes"
        is_secret: true
```

---

## HTTP Server with Authentication

Remote MCP service over HTTPS with bearer token header.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: web-search
  org: acme-corp
  tags:
    - search
    - web
spec:
  description: "Web search MCP service — full-text search and page retrieval"
  http:
    url: "https://mcp.example.com/search/v1"
    headers:
      Authorization: "Bearer ${SEARCH_API_TOKEN}"  # ${VAR} resolved from AgentInstance env
      X-API-Version: "2024-01"
    timeout_seconds: 45
  env_spec:
    data:
      SEARCH_API_TOKEN:
        description: "API token for the web search service"
        is_secret: true
```

---

## HTTP Multi-Tenant Service

Hosted service routing requests per-tenant via headers and query params.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: internal-knowledge-base
  org: acme-corp
  visibility: visibility_private
  labels:
    category: knowledge
spec:
  description: "Internal knowledge base MCP server for policy and procedure lookup"
  http:
    url: "https://api.acme-corp.com/mcp/kb"
    headers:
      Authorization: "Bearer ${KB_SERVICE_TOKEN}"
      X-Tenant-ID: "${TENANT_ID}"
      X-Environment: "${DEPLOY_ENV}"
    query_params:
      version: "v2"
    timeout_seconds: 30
  default_tool_approvals:
    - tool_name: create_article
      message: "Create knowledge base article: {{args.title}}"
    - tool_name: delete_article
      message: "Delete article '{{args.title}}' (id: {{args.article_id}})"
  env_spec:
    data:
      KB_SERVICE_TOKEN:
        description: "Service token for the knowledge base API"
        is_secret: true
      TENANT_ID:
        description: "Tenant identifier for request routing (e.g., acme-corp)"
        is_secret: false
      DEPLOY_ENV:
        description: "Deployment environment: production, staging, or development"
        is_secret: false
```

---

## Marketplace-Ready Public Server

Fully-featured server publishable to the Stigmer marketplace. Designed for use by any organization.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: slack
  org: stigmer
  visibility: visibility_public        # any org can reference this server
  labels:
    category: communication
  annotations:
    docs-url: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack"
    support-url: "https://github.com/stigmer/stigmer/issues"
  tags:
    - slack
    - messaging
    - notifications
    - communication
spec:
  description: "Slack MCP server for channel messaging, search, and workspace management"
  icon_url: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png"
  tags:
    - slack
    - messaging
    - communication
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-slack"]
  default_enabled_tools:
    - list_channels
    - post_message
    - reply_to_thread
    - get_channel_history
    - search_messages
    - add_reaction
  default_tool_approvals:
    - tool_name: post_message
      message: "Post to #{{args.channel_name}}: {{args.text}}"
    - tool_name: reply_to_thread
      message: "Reply in #{{args.channel_name}} thread: {{args.text}}"
    - tool_name: invite_user_to_channel
      message: "Invite {{args.user_id}} to #{{args.channel_name}}"
    - tool_name: archive_channel
      message: "Archive channel #{{args.channel_name}}"
  env_spec:
    data:
      SLACK_BOT_TOKEN:
        description: "Slack Bot User OAuth Token (xoxb-...) with channels:read, chat:write, and search:read scopes"
        is_secret: true
      SLACK_TEAM_ID:
        description: "Slack workspace team ID (e.g., T01234567)"
        is_secret: false
```

**Marketplace server checklist:**
- `metadata.org` explicitly set to publishing org
- `metadata.visibility: visibility_public`
- `metadata.annotations` with `docs-url` and `support-url`
- `env_spec` descriptions are precise — external users need to know exact credentials and required permissions
- `spec.icon_url` set for marketplace display
