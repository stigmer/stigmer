# Clay

Cursor plugin that connects agents to [Clay](https://www.clay.com) through Clay's official hosted [Model Context Protocol](https://modelcontextprotocol.io/) server.

Find and enrich people and companies across 150+ data providers, run AI research agents (Claygent), and trigger your team's approved Clay workflows from the signed-in Clay workspace.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Clay**.
3. Click **Install**, then complete the Clay sign-in prompt.

Or run `/add-plugin clay` in chat.

## MCP

```json
{
  "mcpServers": {
    "clay": {
      "type": "http",
      "url": "https://api.clay.com/v3/mcp"
    }
  }
}
```

Auth is OAuth 2.1 against Clay with Dynamic Client Registration (DCR) and PKCE. Cursor registers itself and prompts for Clay sign-in when the plugin connects — there is no API key or client ID to configure.

## Before you connect

You need a Clay account with access to a workspace.

Your Clay workspace admin may need to allow MCP client connections under Clay workspace **Settings → MCP**. If sign-in succeeds but tools fail, check with your admin.

## What agents can do

| Category | Capabilities |
| --- | --- |
| People & companies | Search Clay's data universe with natural-language criteria |
| Enrichment | Pull emails, phone numbers, firmographics, technographics, and other data points across 150+ providers |
| Research | Ask Claygent open-ended questions about accounts and contacts |
| Workflows | Trigger Clay tables and workflows your team has approved for MCP access |

## Notes

- Tool calls run as the Clay user who authorizes the connection and cannot exceed that user's permissions.
- Workflow triggers are limited to workflows approved for MCP access in the Clay workspace.
- Connections appear in your Clay workspace's MCP client list, labeled with the Cursor client name.
- Revoke access at any time from Clay workspace **Settings → MCP**.

## Docs

- Connect to Clay MCP: https://university.clay.com/docs/connect-to-clay-mcp
- Server URL: https://api.clay.com/v3/mcp

## License

MIT
