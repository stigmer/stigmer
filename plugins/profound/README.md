# Profound

Cursor plugin that connects agents to [Profound](https://www.tryprofound.com) through Profound's official hosted [Model Context Protocol](https://modelcontextprotocol.io/) server.

Retrieve AI visibility, sentiment, and citation reports, access agent analytics, and build or run Profound Agents in the signed-in Profound account.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Profound**.
3. Click **Install**, then complete the Profound sign-in prompt.

Or run `/add-plugin profound` in chat.

## MCP

```json
{
  "mcpServers": {
    "profound": {
      "type": "http",
      "url": "https://mcp.tryprofound.com/mcp"
    }
  }
}
```

Auth is OAuth 2.1 against Profound. Cursor prompts for Profound sign-in when the plugin connects — there is no API key or client ID to configure.

## What agents can do

| Category | Capabilities |
| --- | --- |
| Discovery | Confirm the signed-in user, then list organizations, regions, models, categories, domains, tags, topics, and prompts |
| Visibility | Share of voice, mentions, and position across answer engines such as ChatGPT, Perplexity, Gemini, and Google AI Overviews |
| Citations & sentiment | Track which pages answer engines cite, and how they talk about a brand or category |
| Agent analytics | Bot crawl reports, referral traffic from answer engines, and raw analytics |
| Profound Agents | List, build, publish, and run Agents, then poll runs for status and outputs |

The hosted runtime is the source of truth for tool names and schemas. Call `whoami` as a read-only smoke test after connecting.

## Notes

- Tool calls run as the Profound user who authorizes the connection and cannot exceed that user's permissions.
- Analytics tools are read-only. Agent tools can create, update, publish, and run Agent definitions in the signed-in organization.
- Enterprise plans can authenticate with a long-lived Bearer API key instead of OAuth. This plugin uses the recommended OAuth flow. See [Authentication](https://docs.tryprofound.com/mcp/authentication).

## Docs

- Profound MCP overview: https://docs.tryprofound.com/mcp/overview
- Connect AI coding tools: https://docs.tryprofound.com/mcp/connect
- Analytics capabilities: https://docs.tryprofound.com/mcp/capabilities/analytics-capabilities
- Agents capabilities: https://docs.tryprofound.com/mcp/capabilities/agents-capabilities
- Server URL: https://mcp.tryprofound.com/mcp

Logo is Profound's official GitHub organization mark (white isotype on black).

## License

MIT
