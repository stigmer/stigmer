# McpServer YAML Examples

Complete examples from minimal to marketplace-ready. All examples use valid field values.

## Minimal Stdio Server

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

## Stdio Server with Environment Variables

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  tags:
    - git
    - vcs
spec:
  description: "GitHub MCP server for repository operations, code search, and PR management"
  icon_url: "https://github.githubassets.com/favicons/favicon.svg"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env:
    GITHUB_TOKEN:
      description: "GitHub personal access token with repo and read:org scopes"
      is_secret: true
    GITHUB_OWNER:
      description: "Default GitHub organization or username (e.g., acme-corp)"
      is_secret: false
```

## Stdio Server with Tool Gates and Approval Policies

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  org: acme-corp
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
  env:
    GITHUB_TOKEN:
      description: "GitHub personal access token with repo, read:org, and admin:repo_hook scopes"
      is_secret: true
```

## Database Server with Restricted Defaults

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: postgres
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
  env:
    POSTGRES_URL:
      description: "PostgreSQL connection URL (postgres://user:pass@host/db)"
      is_secret: true
```

## Python Module Server

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: sqlite
spec:
  description: "SQLite MCP server for local database queries"
  stdio:
    command: python
    args: ["-m", "mcp_server_sqlite", "--db-path", "/data/db.sqlite"]
```

## HTTP Server with Header Authentication

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: web-search
  tags:
    - search
    - web
spec:
  description: "Web search MCP service for full-text search and page retrieval"
  http:
    url: "https://mcp.example.com/search/v1"
    headers:
      Authorization: "Bearer ${SEARCH_API_TOKEN}"
      X-API-Version: "2024-01"
    timeout_seconds: 45
  env:
    SEARCH_API_TOKEN:
      description: "API token for the web search service"
      is_secret: true
```

## HTTP Server with Multi-Tenant Routing

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
    query_params:
      version: "v2"
    timeout_seconds: 30
  default_tool_approvals:
    - tool_name: create_article
      message: "Create knowledge base article: {{args.title}}"
    - tool_name: delete_article
      message: "Delete article '{{args.title}}' (id: {{args.article_id}})"
  env:
    KB_SERVICE_TOKEN:
      description: "Service token for the knowledge base API"
      is_secret: true
    TENANT_ID:
      description: "Tenant identifier for request routing (e.g., acme-corp)"
      is_secret: false
```

## Public Marketplace Server (Full-Featured)

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: Slack
  org: stigmer
  visibility: visibility_public
  labels:
    category: communication
    tier: production
  annotations:
    docs-url: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack"
    support-url: "https://github.com/stigmer/stigmer/issues"
  tags:
    - slack
    - messaging
    - communication
spec:
  description: "Slack MCP server for channel messaging, search, and workspace management"
  icon_url: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png"
  tags:
    - slack
    - messaging
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
  env:
    SLACK_BOT_TOKEN:
      description: "Slack Bot User OAuth Token (xoxb-...) with channels:read, chat:write, search:read scopes"
      is_secret: true
    SLACK_TEAM_ID:
      description: "Slack workspace team ID (e.g., T01234567)"
      is_secret: false
```

Marketplace characteristics:
- `metadata.org` set to the publishing organization
- `metadata.visibility: visibility_public` — any org can reference it
- `metadata.annotations` include support/documentation URLs
- `env` descriptions precise enough for external users
