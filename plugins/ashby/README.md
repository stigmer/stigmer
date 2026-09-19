# Ashby

Cursor plugin that connects agents to [Ashby](https://www.ashbyhq.com) through Ashby's official remote [Model Context Protocol](https://modelcontextprotocol.io/) server.

Search candidates and jobs, prepare for interviews, review pipeline status and pending tasks, and take recruiting actions in the signed-in Ashby workspace.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Ashby**.
3. Click **Install**, then complete the Ashby sign-in prompt.

Or run `/add-plugin ashby` in chat.

## MCP

```json
{
  "mcpServers": {
    "ashby": {
      "type": "http",
      "url": "https://mcp.ashbyhq.com/mcp/v1"
    }
  }
}
```

Auth is OAuth 2.0 against Ashby. Cursor prompts for Ashby sign-in when the plugin connects — there is no API key to configure. Ashby supports dynamic client registration.

## Before you connect

An Org Admin must enable the MCP Server toggle under **Admin → Organization Setup → Opt-In Features** before anyone in the organization can connect.

Once enabled, Elevated Access users can connect their own Ashby account. The MCP server is available on all Ashby plans, but not to Analytics-only organizations.

## Notes

- Tool calls run as the Ashby user who authorizes the connection and cannot exceed that user's permissions.
- Ashby MCP rate-limits requests and tool-budget units per minute; see Ashby's docs if you hit limits.
- MCP tool inputs and outputs may change without notice. For a stable contract, use Ashby's [public API](https://developers.ashbyhq.com/reference/introduction).

## Docs

- Ashby MCP server (beta): https://docs.ashbyhq.com/ashby-mcp-server-beta
- Server URL: https://mcp.ashbyhq.com/mcp/v1

Logo is Ashby's official app icon (white serif A on the brand blue tile) from https://www.ashbyhq.com/favicon.png.

## License

MIT
