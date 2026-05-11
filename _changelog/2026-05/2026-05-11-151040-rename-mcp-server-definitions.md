# Remove Redundant mcp-server- Prefix from MCP Server Definitions

**Date**: May 11, 2026

## Summary

Renamed all 54 MCP server definitions in the seedpack to use clean, properly-capitalized product names instead of the slug-style `mcp-server-*` prefix. Since the resource `kind` is already `McpServer`, the prefix was redundant and cluttered the UI.

## Problem Statement

MCP server definitions used names like `mcp-server-atlassian`, `mcp-server-brave-search`, `mcp-server-github` — the `mcp-server-` prefix added no information because users already know they're looking at MCP servers (the `kind` field communicates that).

### Pain Points

- Redundant prefix makes names longer and harder to scan in the library UI
- Inconsistent with how users think about these products (nobody says "mcp-server-slack", they say "Slack")
- The slug-style naming looked technical rather than user-friendly

## Solution

Stripped the `mcp-server-` prefix from both filenames and `metadata.name` values, replacing them with properly-capitalized display names that respect each product's brand casing.

## Implementation Details

- Updated `metadata.name` in all 54 YAML files to use display names (e.g., `Brave Search`, `GitHub`, `AWS Lambda`, `SQLite`)
- Renamed files via `git mv` to preserve history (e.g., `mcp-server-atlassian.yaml` -> `atlassian.yaml`)
- Preserved brand casing: `GitHub`, `GitLab`, `HubSpot`, `PagerDuty`, `PayPal`, `MongoDB`, `MySQL`, `SQLite`
- Multi-word products use space-separated title case: `Brave Search`, `Google Calendar`, `Sequential Thinking`
- Acronyms preserved: `AWS CDK`, `AWS Lambda`, `AWS Documentation`

## Benefits

- Cleaner, more readable names in the MCP server library UI
- Names now match how users naturally refer to these products
- File names are shorter and easier to work with

## Impact

The seedpack loader will delete the old entries and recreate with the new names on next load — no database migration needed.

---

**Status**: Production Ready
