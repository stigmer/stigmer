# T02: Developer Tools & Database MCP Server Definitions

**Date**: April 8, 2026

## Summary

Added 7 new MCP server definitions to the Stigmer marketplace seedpack, covering developer tools (Linear, Atlassian, GitLab) and databases (MongoDB, MySQL, PostgreSQL, SQLite). This batch introduces two new transport patterns — `spec.http` for hosted remote MCP servers and `uvx` for Python-based stdio servers — expanding the seedpack from 4 to 11 entries across 3 transport types.

## Problem Statement

The marketplace seedpack only contained 4 MCP server definitions (mcp-server-stigmer, GitHub, Brave Search, Slack), all using `spec.stdio` with `npx` or `go run`. Popular developer tools (Linear, Jira/Atlassian, GitLab) and databases (MongoDB, MySQL, PostgreSQL, SQLite) were missing, and two major transport patterns had no representation in the catalog.

### Pain Points

- Platform builders had no database MCP server definitions out of the box
- The `spec.http` transport (for hosted remote MCP servers) had zero coverage in the seedpack despite being fully supported by the agent-runner
- Python MCP servers (via `uvx`) had no representation despite the agent-runner Dockerfile explicitly installing `uv`/`uvx`
- The CONTRIBUTING.md only documented the `npx` stdio pattern, making it harder for contributors to add HTTP or Python servers

## Solution

Researched 7 MCP servers, resolved 5 architectural surprises collaboratively, and wrote marketplace-quality YAML definitions across all 3 supported transport types. Updated the contributor guide with templates and examples for the new patterns.

## Implementation Details

### New Servers

| Server | Transport | Package/Endpoint | Category |
|--------|-----------|-----------------|----------|
| Linear | `spec.http` | `https://mcp.linear.app/mcp` | developer |
| Atlassian | `spec.http` | `https://mcp.atlassian.com/v1/mcp` | developer |
| MongoDB | `spec.stdio` (npx) | `mongodb-mcp-server` | database |
| MySQL | `spec.stdio` (npx) | `@benborla29/mcp-server-mysql` | database |
| GitLab | `spec.stdio` (npx) | `@modelcontextprotocol/server-gitlab` | database |
| PostgreSQL | `spec.stdio` (uvx) | `postgres-mcp` (CrystalDBA) | database |
| SQLite | `spec.stdio` (uvx) | `mcp-server-sqlite` | database |

### Key Design Decisions

- **PostgreSQL**: Chose `crystaldba/postgres-mcp` over the archived reference server (`@modelcontextprotocol/server-postgres`) which has a known SQL injection vulnerability. CrystalDBA uses `DATABASE_URI` env var (perfect for env_spec) and has restricted mode with pglast-based SQL injection protections.
- **Atlassian scope**: Named `atlassian` (not `jira`) because the official endpoint covers Jira + Confluence + Compass. Used Bearer auth (service account API key) since Basic auth's base64 encoding doesn't fit the `${VAR}` placeholder model.
- **GitLab**: Used the npm package (`@modelcontextprotocol/server-gitlab`) despite source removal from the `modelcontextprotocol/servers` repo, because the HTTP alternative requires Premium/Ultimate + Duo.
- **Tool approvals**: Added `default_tool_approvals` for MongoDB (drop-database, drop-collection, delete-many), GitLab (create_or_update_file, push_files, fork_repository), and SQLite (write_query, create_table) where tool names are verified from official documentation.

### CONTRIBUTING.md Updates

- Added HTTP server template with `spec.http` and Bearer auth pattern
- Added runtime comparison table (npx, uvx, go) for stdio servers
- Updated env_spec documentation to cover all 3 delivery mechanisms (process env, arg interpolation, header/query param interpolation)

## Benefits

- Seedpack now covers the most common developer tool and database MCP servers
- Both transport types (`spec.stdio` and `spec.http`) are exercised in the catalog
- All 3 supported runtimes (npx, uvx, go) are represented
- Contributors have clear templates for adding HTTP and Python-based servers
- Safe defaults: PostgreSQL uses restricted mode, MySQL is read-only by default, MongoDB has approval policies for destructive operations

## Impact

- **Platform builders**: 7 new servers available out of the box, covering databases and developer tools
- **Contributors**: CONTRIBUTING.md now documents all transport and runtime patterns
- **Architecture**: Validates that `spec.http` and `uvx` patterns work end-to-end through the seedpack pipeline

## Related Work

- [MCP Marketplace Catalog — First 3 Servers](2026-04-08-152617-mcp-marketplace-catalog-first-3-servers.md) (T01)
- [Stdio Arg Interpolation and GitHub MCP Update](2026-04-08-154755-stdio-arg-interpolation-and-github-mcp-update.md) (pre-T02 infrastructure)

---

**Status**: ✅ Production Ready
**Timeline**: Session 3 of MCP Marketplace Catalog project
