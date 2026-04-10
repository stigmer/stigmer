# Curated MCP Marketplace: 36 Hand-Picked Server Definitions

**Date**: April 10, 2026

## Summary

Created 36 curated MCP server YAML definitions across 14 categories, replacing the automated registry sync with a hand-vetted marketplace of high-quality MCP servers. Each definition uses official first-party sources where available, covering four transport patterns (npx, uvx, go run, HTTP hosted). This is the culmination of a 3-task project that also removed the Temporal sync workflow and cleaned up the proto schema.

## Problem Statement

The automated MCP Registry sync (Temporal workflow) pulled ~5,000 servers from `registry.modelcontextprotocol.io`, quality-filtered by GitHub stars, and bulk-upserted into the database. This created several problems:

### Pain Points

- Too many low-value servers landed on the platform with no editorial control
- Raw registry metadata was often incomplete or misleading
- The Temporal workflow hit the 50MB history limit, causing operational issues
- Users had no signal for which servers were trustworthy or well-maintained

## Solution

Replace the automated sync with a hand-curated set of 36 MCP server definitions maintained as YAML files in the seedpack. Each server was individually vetted for repository activity, documentation quality, stable transport, and package availability.

## Implementation Details

### Three-Task Execution

1. **Task 1** (stigmer-cloud): Deleted 12 synced servers from DB, removed 23 sync-specific Java files, refactored shared Temporal worker infrastructure. PR: stigmer-cloud#114.
2. **Task 2** (stigmer + stigmer-cloud): Deleted `McpServerSource` message from proto, flattened `repository_url` and `github_stars` onto `McpServerSpec`, regenerated all stubs, rewrote CONTRIBUTING.md.
3. **Task 3** (stigmer): Created 36 YAML files, validated all through protojson loader, updated CONTRIBUTING.md with multi-transport templates. PR: stigmer#115.

### Transport Patterns

| Pattern | Command | Count | Examples |
|---------|---------|-------|----------|
| stdio via npx | `npx -y <package>` | 20 | Brave Search, MongoDB, Playwright, Stripe |
| stdio via uvx | `uvx <package>` | 5 | Redis, PostgreSQL, AWS Documentation/CDK/Lambda |
| stdio via go run | `go run <module>@latest` | 2 | GitHub, Terraform |
| HTTP hosted | Remote URL + Bearer auth | 9 | GitLab, Linear, Slack, Notion, Figma, Atlassian |

### Category Distribution

| Category | Count | Servers |
|----------|-------|---------|
| Developer Tools | 4 | GitHub, GitLab, Git, Filesystem |
| Databases | 7 | PostgreSQL, SQLite, MongoDB, Redis, MySQL, Neon, Supabase |
| Search | 4 | Brave Search, Exa, Tavily, Fetch |
| Cloud/Infrastructure | 6 | AWS Documentation, AWS CDK, AWS Lambda, Cloudflare, Kubernetes, Terraform |
| Communication | 2 | Slack, Linear |
| Productivity | 2 | Notion, Google Maps |
| Web Automation | 1 | Playwright |
| Monitoring | 1 | Sentry |
| Payments | 1 | Stripe |
| Design | 1 | Figma |
| AI/Reasoning | 2 | Sequential Thinking, Memory |
| Notifications | 2 | Twilio, Resend |
| Scheduling | 1 | Google Calendar |
| CRM/Support | 2 | Salesforce, Atlassian |

### Key Discovery: Ecosystem Maturation

The `modelcontextprotocol/servers` monorepo (83K stars) archived most reference servers in May 2025. Only 6 remain active (Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking). Vendors now maintain their own MCP servers:

- **Brave** (`@brave/brave-search-mcp-server`), **Sentry** (`@sentry/mcp-server`), **GitHub** (`github/github-mcp-server` in Go)
- **Slack** (`mcp.slack.com/mcp`), **GitLab** (`gitlab.com/api/v4/mcp`), **Atlassian** (`mcp.atlassian.com/v1/mcp`), **Figma** (`mcp.figma.com/mcp`), **Google Maps** (`mapstools.googleapis.com/mcp`) -- all hosted HTTP with OAuth

## Benefits

- **Trust signal**: Every server in the marketplace is individually vetted, not bulk-imported from a registry
- **Official sources**: 30+ servers use first-party vendor packages or hosted endpoints
- **No operational burden**: Eliminated the Temporal sync workflow (50MB history limit, daily schedule, 288 upserted servers)
- **Clean proto**: Removed 8 sync-specific fields from `McpServerSource`, flattened useful fields directly onto `McpServerSpec`
- **Multi-transport**: Supports npx, uvx, go run, and HTTP -- covering Node.js, Python, Go, and hosted server ecosystems

## Impact

- **Users**: See a curated marketplace of 36 high-quality, categorized MCP servers instead of 288 bulk-imported entries
- **Platform**: Simpler data model (no `McpServerSource` wrapper), no Temporal sync workflow to maintain
- **Contributors**: Clear CONTRIBUTING.md with templates for all four transport patterns and a defined quality bar

## Related Work

- Task 1 PR (stigmer-cloud): https://github.com/stigmer/stigmer-cloud/pull/114
- Task 3 PR (stigmer): https://github.com/stigmer/stigmer/pull/115
- Proto cleanup commit: `c592e810 refactor(apis/mcpserver): delete McpServerSource and flatten provenance onto McpServerSpec`

---

**Status**: PR open, pending merge and live validation
**Timeline**: 3 sessions across 1 day (Task 1 + Task 2 + Task 3)
