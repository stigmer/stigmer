An MCP Server defines a reusable tool provider that agents can connect to via the
Model Context Protocol. It declares the server type (stdio or HTTP), connection
details, and required environment variables. When an HTTP server takes a
sign-in, the `auth` block names the variable its login fills; the sign-in itself
starts from the server's address and saves into a vault.
Connecting discovers the server's tools; a tool the server marks destructive
(`destructiveHint: true`) asks for approval before it runs.

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
  env:
    GITHUB_TOKEN:
      is_secret: true
      description: "GitHub personal access token"
```
