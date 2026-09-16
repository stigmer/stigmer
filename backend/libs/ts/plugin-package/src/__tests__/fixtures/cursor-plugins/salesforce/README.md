# Salesforce

Cursor plugin that connects agents to [Salesforce](https://www.salesforce.com) through [Salesforce Hosted MCP](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/), Salesforce's first-party [Model Context Protocol](https://modelcontextprotocol.io/) service.

Run SOQL and SOSL, inspect object schemas, traverse relationships, and create, update, or delete records — all under the signed-in user's own permissions and field-level security.

## Install

1. Open **Cursor Settings → Plugins**.
2. Search for **Salesforce**.
3. Click **Install**, then set the server URL and consumer key (below) and complete the Salesforce sign-in prompt.

Or run `/add-plugin salesforce` in chat.

## MCP

```json
{
  "mcpServers": {
    "salesforce": {
      "type": "http",
      "url": "${SALESFORCE_MCP_URL}",
      "auth": {
        "CLIENT_ID": "${CLIENT_ID}",
        "scopes": ["mcp_api", "refresh_token"]
      }
    }
  }
}
```

## Setup

Salesforce Hosted MCP requires an **External Client App** in your org. Connected Apps are not supported.

### 1. Create the External Client App

From Setup, go to **External Client App Manager → New External Client App**, fill in the basics, then expand **API (Enable OAuth Settings)** and check **Enable OAuth**.

Add every callback URL you need — Cursor uses different ones per surface:

| Surface | Callback URL |
|:--------|:-------------|
| Desktop | `http://localhost:8787/callback` |
| Web and Cloud Agents | `https://www.cursor.com/agents/mcp/oauth/callback` |
| Older desktop builds | `cursor://anysphere.cursor-mcp/oauth/callback` |

Under **OAuth Scopes**, select exactly these two and nothing broader:

- **Access Salesforce hosted MCP servers** (`mcp_api`)
- **Perform requests at any time** (`refresh_token`, `offline_access`)

The second one is easy to miss because the picker labels scopes by description rather than by value. Without it the plugin cannot refresh, and every user has to re-authenticate when their access token expires. Do not add **Full access** (`full`) — Hosted MCP does not need it.

Under **Security**, select **Issue JSON Web Token (JWT)-based access tokens for named users**. This is required: without it Salesforce issues opaque tokens and every tool call fails with `JWT Token is required`. Leave **Require Secret for Web Server Flow** off — Cursor authenticates as a public client using PKCE, so no client secret is involved. Do not enable the **JWT Bearer Flow**, which is a different feature and needs a certificate.

Finally, copy the **Consumer Key** from **Settings → Consumer Key and Secret**.

A new External Client App can take up to 30 minutes to propagate. Until it does, authentication fails with `invalid_client_id`; wait rather than recreating the app.

### 2. Activate a server and copy its URL

In Setup, open **MCP Servers**, activate the server you want, and copy its **Server URL**. The URL encodes both the org type and the server:

| Org type | Standard server | Custom server |
|:---------|:----------------|:--------------|
| Production, Developer, Enterprise | `https://api.salesforce.com/platform/mcp/v1/platform/sobject-all` | `https://api.salesforce.com/platform/mcp/v1/custom/myserver` |
| Sandbox or scratch | `https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-all` | `https://api.salesforce.com/platform/mcp/v1/sandbox/custom/myserver` |

Salesforce ships several standard servers with different blast radii — `sobject-reads` for read-only access, `sobject-mutations` for reads plus create and update, `sobject-deletes`, and `sobject-all` for everything. Point the plugin at the narrowest one that does the job.

### 3. Configure the plugin

In **Dashboard → Plugins → Configure**, set **Salesforce MCP server URL** and **Salesforce Consumer Key**, then complete the Salesforce login when Cursor prompts.

On a team marketplace an admin sets both values once. Each member still authenticates individually, so tools run with that member's own object and field permissions.

## Troubleshooting

| Symptom | Cause |
|:--------|:------|
| `invalid_client_id` | The External Client App has not finished propagating. Wait up to 30 minutes. |
| `invalid_scope` | The app is missing **Access Salesforce hosted MCP servers** or **Perform requests at any time**. |
| `JWT Token is required` or `Invalid token` after a successful login | **Issue JSON Web Token (JWT)-based access tokens for named users** is not enabled. |
| Auth succeeds but the server 404s | The MCP server is not activated in Setup, or the URL's org type does not match the org you logged into. |

## Docs

- Configure Cursor: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/cursor.html
- Create an External Client App: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/create-external-client-app.html
- Available servers: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-all.html

## License

MIT
