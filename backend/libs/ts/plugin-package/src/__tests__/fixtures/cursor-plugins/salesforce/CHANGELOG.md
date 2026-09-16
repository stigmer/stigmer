# Changelog

All notable changes to this plugin will be documented here.

## 1.0.0 — initial release

- Logo: Salesforce's official cloud mark, centered on a transparent 192×192 canvas with padding so it reads well on light and dark backgrounds.
- Added the `salesforce` MCP server backed by Salesforce Hosted MCP.
- Declared `SALESFORCE_MCP_URL` and `CLIENT_ID` plugin variables so each org can point at its own server and External Client App.
- Pinned OAuth scopes to `mcp_api` and `refresh_token`.
