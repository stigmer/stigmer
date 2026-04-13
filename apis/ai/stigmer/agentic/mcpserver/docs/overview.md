An MCP Server defines a reusable tool provider that agents can connect to via the
Model Context Protocol. It declares the server type (stdio or HTTP), connection
details, and required environment variables. When a server supports OAuth, the
`auth` block configures automated token acquisition via an OAuthApp reference.
Tool approval policies are auto-classified when you connect, and manual overrides
go in `pinned_tool_approvals`.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: github
  slug: github
spec:
  description: "GitHub MCP server for repository operations"
  stdio:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
  env_spec:
    data:
      GITHUB_TOKEN:
        is_secret: true
        description: "GitHub personal access token"
  pinned_tool_approvals:
    - tool_name: delete_repository
      message: "Delete repository: {{args.repo}}"
```
