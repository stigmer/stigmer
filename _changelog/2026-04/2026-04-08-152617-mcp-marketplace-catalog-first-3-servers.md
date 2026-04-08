# MCP Marketplace Catalog: First 3 Server Definitions

**Date**: April 8, 2026

## Summary

Added the first 3 marketplace McpServer YAML definitions to the seedpack — GitHub, Brave Search, and Slack — establishing the template, naming conventions, and contributor workflow for populating the Stigmer MCP marketplace. Also created a contributor guide and switched the built-in stigmer MCP server from a pinned version to `@latest`.

## Problem Statement

Stigmer ships with a single McpServer definition (`mcp-server-stigmer`). Platform builders who adopt Stigmer face an empty marketplace with no ready-to-use third-party MCP server integrations. Users should only need to bring their own credentials — the marketplace should provide the server configurations.

### Pain Points

- Empty marketplace offers no immediate value to new adopters
- No established pattern for adding third-party MCP server definitions
- No contributor guide or quality checklist for marketplace entries
- Manual version pinning in `mcp-server-stigmer.yaml` required updates for every release

## Solution

Studied the McpServer proto schema, established a canonical YAML template with confirmed design decisions, wrote 3 marketplace-ready definitions, and documented the contributor workflow.

## Implementation Details

### Marketplace YAML Template

Established conventions for all marketplace entries:
- `metadata.name`: follows upstream naming (no "MCP Server" suffix)
- `metadata.tags`: powers FTS5 search (not `spec.tags` which is CLI-only)
- `metadata.labels.stigmer.ai/category`: structured filtering label
- `metadata.slug` and `metadata.org`: omitted (auto-generated/auto-resolved)
- No version pinning for npm packages (~300ms registry check is acceptable)

### Server Definitions

| Server | Category | Tools | Approval Policies | Env Vars |
|--------|----------|-------|-------------------|----------|
| GitHub | developer | 26 | 4 (merge, file write, push, PR review) | GITHUB_PERSONAL_ACCESS_TOKEN |
| Brave Search | search | 2 | 0 (read-only) | BRAVE_API_KEY |
| Slack | communication | 8 | 2 (post message, reply to thread) | SLACK_BOT_TOKEN, SLACK_TEAM_ID |

### Contributor Guide

`seedpack/mcp-servers/CONTRIBUTING.md` covers the full "Add a New Server" workflow: research upstream, write YAML from template, validate, discover capabilities, and verify tool names.

### Built-in Server Change

`mcp-server-stigmer.yaml` updated from `@v0.0.52` to `@latest` — eliminates manual version bump maintenance.

## Benefits

- Platform builders get 3 ready-to-use MCP server integrations on day one
- Clear, documented pattern for adding more servers (T02-T04 can batch-produce)
- Contributor guide lowers the barrier for community contributions
- No more manual version bumps for the built-in MCP server

## Impact

- **Seedpack**: 3 new YAML files + 1 contributor guide added to `seedpack/mcp-servers/`
- **Bootstrap**: Every new Stigmer installation gets GitHub, Brave Search, and Slack server definitions
- **Marketplace**: First populated entries for the MCP marketplace

## Related Work

- T02-T04 (pending): Tier 1 servers for developer tools, databases, communication, productivity, cloud, and utility categories
- Agent-runner `${VAR}` arg interpolation (future): Would unlock PostgreSQL, Filesystem, SQLite marketplace entries that use positional CLI args

---

**Status**: Production Ready
**Timeline**: 1 session
