# Navan

Cursor plugin that connects agents to [Navan](https://navan.com) through Navan's official remote [Model Context Protocol](https://modelcontextprotocol.io/) server.

Query expenses and spend trends, analyze travel bookings across flights, hotels, and ground transport, ask about policies, approval flows, and flag/decline reasons, and look up card details for the signed-in Navan user.

## Prerequisite

A Navan admin must enable MCP for your organization first: **Navan → Configuration → Integrations → MCP** and toggle it on. Until then, connections from any MCP client will fail.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Navan**.
3. Click **Install**, then complete the Navan SSO sign-in prompt.

Or run `/add-plugin navan` in chat.

## MCP

```json
{
  "mcpServers": {
    "navan": {
      "type": "http",
      "url": "https://mcp.navan.com/mcp"
    }
  }
}
```

Auth is OAuth 2.0 against Navan's standard SSO login. The first request opens a browser window to sign in and approve scopes — there is no API key or client ID to configure. Sessions refresh automatically while in use; sign in again after 100 days of inactivity or 365 days since authentication.

## Notes

- Tool calls run under the signed-in user's context and role (Employee, Manager, Approver, Finance Admin) and cannot exceed that user's Navan permissions.
- Queries for data the user is not authorized to see return an empty result with a `403_BY_POLICY` annotation rather than leaking data.
- The server cannot bypass approval workflows, policy rules, or duplicate detection, and cannot escalate privileges.
- Every tool call is logged in Navan's audit trail with the user identity, client name/version, tool arguments, and response status.
- Keep payloads lean: pass specific date ranges, filter to the fields you need, and prefer summary tools (e.g. `summarize_spend`) before drilling into raw rows.
- Navan MCP is not intended for high-volume or scheduled workloads — use the [Navan REST API](https://developer.navan.com/) for those.

## Verify

Once connected, ask the agent:

> "Use Navan to list my five most recent expenses."

A correctly connected client returns a structured table within a few seconds. If you see a permission prompt, approve it — that is Navan's scoped-consent flow.

## Docs

- Navan MCP guide: https://developer.navan.com/mcp/
- Server URL: https://mcp.navan.com/mcp
