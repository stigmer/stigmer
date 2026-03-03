# McpServer YAML Examples

Production-ready examples covering common patterns. All field values are valid and can be applied directly.

---

## 1. Minimal — stdio, no credentials

The smallest valid McpServer. Works for MCP servers that need no environment variables.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: filesystem
  org: default
spec:
  description: "Local filesystem access — read and write files in allowed directories"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

---

## 2. stdio with credentials (GitHub)

Standard pattern for most community MCP servers — subprocess with secret env vars.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: default
spec:
  description: "GitHub MCP server for repository operations, code search, and PR management"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        description: "GitHub personal access token with repo, read:org, and admin:repo_hook scopes"
        is_secret: true
      GITHUB_OWNER:
        description: "Default GitHub organization or username (e.g., acme-corp)"
        is_secret: false
```

---

## 3. stdio with tool gate and approvals (GitHub, production-ready)

Full GitHub integration with a curated tool list and approval policies for destructive operations.

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
    - list_branches
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

## 4. stdio — Python module (SQLite/Postgres database)

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: postgres
  org: default
  labels:
    category: database
  tags:
    - database
    - sql
    - postgresql
spec:
  description: "PostgreSQL MCP server for query execution and schema inspection"
  stdio:
    command: python
    args: ["-m", "mcp_server_postgres"]
  default_enabled_tools:
    - execute_query
    - list_tables
    - describe_table
    - list_schemas
    # execute_ddl and drop_table intentionally omitted — too destructive for defaults
  default_tool_approvals:
    - tool_name: execute_query
      message: "Execute SQL: {{args.query}}"
  env_spec:
    data:
      POSTGRES_URL:
        description: "PostgreSQL connection URL (postgres://user:pass@host/dbname)"
        is_secret: true
```

---

## 5. stdio — Slack messaging

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: slack
  org: default
  tags:
    - slack
    - messaging
    - communication
spec:
  description: "Slack MCP server for channel messaging, search, and workspace management"
  icon_url: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-slack"]
  default_enabled_tools:
    - list_channels
    - get_channel_history
    - search_messages
    - add_reaction
    - post_message
    - reply_to_thread
  default_tool_approvals:
    - tool_name: post_message
      message: "Post to #{{args.channel_name}}: {{args.text}}"
    - tool_name: reply_to_thread
      message: "Reply in #{{args.channel_name}} thread"
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

---

## 6. HTTP server with bearer auth

For managed/hosted MCP services exposed over HTTPS.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: web-search
  org: default
  tags:
    - search
    - web
spec:
  description: "Web search MCP service — full-text search and page retrieval"
  http:
    url: "https://mcp.example.com/search/v1"
    headers:
      Authorization: "Bearer ${SEARCH_API_TOKEN}"
      X-API-Version: "2024-01"
    timeout_seconds: 45
  env_spec:
    data:
      SEARCH_API_TOKEN:
        description: "API token for the web search MCP service"
        is_secret: true
```

---

## 7. HTTP server — multi-tenant with headers + query params

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

## 8. Public marketplace McpServer

Designed to be referenced by agents from any organization.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: stigmer
  visibility: visibility_public
  labels:
    category: vcs
    tier: production
  annotations:
    docs-url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github"
    support-url: "https://github.com/stigmer/stigmer/issues"
  tags:
    - git
    - vcs
    - code-review
    - github
spec:
  description: "GitHub MCP server for repository operations, code search, and PR management. Requires a GitHub PAT with repo and read:org scopes."
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
        description: "GitHub personal access token with repo, read:org, and admin:repo_hook scopes. Create at https://github.com/settings/tokens"
        is_secret: true
```

---

## Post-Apply CLI Workflow

```bash
# Apply the McpServer
stigmer mcp-server apply github.yaml

# Discover tools (run locally — credentials stay on your machine)
stigmer discover mcp-server github

# Inspect discovered tool names (use these for default_enabled_tools and default_tool_approvals)
stigmer mcp-server get github --output yaml

# Dry-run validation only
stigmer mcp-server apply github.yaml --dry-run
```
