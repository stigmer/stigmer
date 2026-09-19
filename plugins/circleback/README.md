# Circleback

Cursor plugin that connects agents to [Circleback](https://circleback.ai) through Circleback's official remote [Model Context Protocol](https://modelcontextprotocol.io/) server.

Search meetings, transcripts, action items, calendar events, and emails, and look up people and companies in the signed-in Circleback account.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Circleback**.
3. Click **Install**, then complete the Circleback sign-in prompt.

Or run `/add-plugin circleback` in chat.

## MCP

```json
{
  "mcpServers": {
    "circleback": {
      "type": "http",
      "url": "https://circleback.ai/api/mcp"
    }
  }
}
```

Auth is OAuth 2.0 against Circleback with Dynamic Client Registration (DCR) and PKCE. Cursor registers itself and prompts for Circleback sign-in when the plugin connects — there is no API key or client ID to configure.

## Notes

- Tool calls run as the Circleback user who authorizes the connection and cannot exceed that user's permissions.
- Agents can search meetings and transcripts, pull notes and action items, search calendar and email, and look up people or companies tied to your Circleback history.

## Docs

- Circleback MCP: https://support.circleback.ai/en/articles/13249081-circleback-mcp
- Server URL: https://circleback.ai/api/mcp

Logo is Circleback's official apple-touch icon from https://circleback.ai/apple-touch-icon.png.

## License

MIT
