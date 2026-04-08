# MCP Server Marketplace — Seedpack

## How the Marketplace is Populated

Marketplace MCP server definitions are **automatically synced** from the
[Official MCP Registry](https://registry.modelcontextprotocol.io) via a
scheduled Temporal workflow in stigmer-cloud. The workflow:

1. Paginates the registry API (`GET /v0/servers`)
2. Filters to latest versions only (`isLatest: true`)
3. Transforms each entry to a Stigmer `McpServer` proto
4. Upserts directly into the database

Each synced entry carries a `spec.source` field tracking provenance
(registry name, version, repository URL, last sync timestamp).

**Do not manually add marketplace server YAMLs here.** They will be
overwritten or duplicated by the sync workflow.

## What Lives in Seedpack

This directory contains **only** the system MCP server:

- `mcp-server-stigmer.yaml` — The built-in Stigmer platform server,
  labeled `stigmer.ai/system: "true"`. This is bootstrapped via
  `stigmer apply` and is not synced from any external registry.

## Proto Schema Reference

- [McpServer spec](../../apis/ai/stigmer/agentic/mcpserver/v1/spec.proto) —
  includes `McpServerSource` for provenance tracking
- [Environment spec](../../apis/ai/stigmer/agentic/environment/v1/spec.proto) —
  `env_spec` declaration for server configuration

## MCP Registry API

| Endpoint | Description |
|----------|-------------|
| `GET /v0/servers?limit=100` | List servers (cursor-paginated) |
| `GET /v0/servers?limit=100&cursor=<cursor>` | Next page |

Each entry follows the [server.json schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
