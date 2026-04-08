# Automated MCP Registry Sync Pipeline

**Date**: April 8, 2026

## Summary

Replaced manual authoring of MCP marketplace server definitions with an automated synchronization pipeline that continuously pulls from the official MCP Registry into the Stigmer platform database. This eliminates the need for hand-maintained YAML files and establishes a scalable foundation for keeping the marketplace current as the MCP ecosystem grows.

## Problem Statement

The initial approach to populating the Stigmer MCP marketplace required engineers to manually research, author, and validate individual McpServer YAML files for each server. With hundreds of servers already in the official MCP Registry (and growing rapidly), this approach could not scale.

### Pain Points

- Manually authoring 15-20 YAMLs was feasible; keeping pace with 200+ registry entries was not
- No mechanism to detect when upstream servers were updated, deprecated, or removed
- Seedpack (compile-time embedded) was the wrong persistence layer for a continuously-evolving catalog
- No provenance tracking — impossible to tell which definitions came from the registry vs. hand-authored

## Solution

Implemented a Temporal workflow-based sync pipeline that runs on a daily cron schedule, fetches all servers from the official MCP Registry API, transforms them into Stigmer `McpServer` protobuf resources, and upserts them into the platform database. The pipeline includes deduplication (only syncing latest versions), deprecation detection (labeling servers removed from the registry), and data preservation (never overwriting manually curated fields like tool approvals).

## Implementation Details

### Proto Layer (stigmer OSS)

Added `McpServerSource` message to `McpServerSpec` for provenance tracking:

- `registry`: Source registry identifier (e.g. `modelcontextprotocol.io`)
- `registry_name`: Original name in the registry (e.g. `ai.exa/exa`)
- `version`: Version string from the registry
- `repository_url`: Source code repository
- `last_synced_at`: Timestamp of the most recent sync

Removed 10 handcrafted marketplace YAMLs from `seedpack/mcp-servers/`, keeping only the system `mcp-server-stigmer.yaml`. Updated `CONTRIBUTING.md` to reflect the new automated model.

### Temporal Workflow (stigmer-cloud)

16 new Java files implementing the sync pipeline:

**Workflow**: `McpRegistrySyncWorkflow` — orchestrates the full sync cycle:
1. Paginates through registry API (`FetchRegistryPageActivity`)
2. Filters for `isLatest == true` entries (deduplication)
3. Transforms to McpServer proto (`McpRegistryTransformer`)
4. Batch upserts to database (`UpsertMcpServerBatchActivity`)
5. Marks removed servers as deprecated (`MarkDeprecatedServersActivity`)

**Transform logic** (`McpRegistryTransformer`):
- `packages[]` (npm/pypi) → `spec.stdio` with `npx`/`uvx` command
- `remotes[]` → `spec.http` with header-based auth
- Environment variables → `spec.env_spec` entries
- Icons → `spec.icon_url`
- Full provenance → `spec.source`

**Data preservation** (`UpsertMcpServerBatchActivity`):
- `spec.default_tool_approvals` — never overwritten by sync
- `spec.default_enabled_tools` — never overwritten by sync
- `status.discovered_capabilities` — implicitly preserved (status block untouched)

**Scheduling**: `McpRegistrySyncScheduleRegistrar` creates a Temporal Schedule on application startup for daily cron execution.

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Temporal workflow (not CLI command) | Scheduled, fault-tolerant, observable, no manual trigger |
| Official MCP Registry only (Phase 1) | Only source with structured REST API and `server.json` schema |
| Database-only catalog (not seedpack) | Seedpack is compile-time embedded; DB handles continuous updates |
| Deprecation via label (not deletion) | Preserves references; users can see deprecation status |
| Preserve curated fields on upsert | Registry doesn't provide tool approvals — manual curation is protected |

## Benefits

- **Scalable**: Automatically ingests hundreds of MCP servers without manual effort
- **Current**: Daily sync keeps the marketplace up-to-date with upstream changes
- **Traceable**: Every synced server carries full provenance (registry, version, sync timestamp)
- **Safe**: Manual curation (tool approvals, enabled tools, discovered capabilities) is never lost during sync
- **Deprecation-aware**: Servers removed from the registry are automatically flagged

## Impact

- **Platform builders**: Get immediate access to the full MCP ecosystem out of the box
- **Platform operators**: No ongoing manual work to keep the marketplace current
- **End users**: Can discover and enable any MCP server available in the ecosystem
- **Engineering**: Seedpack is simplified to system-only definitions; marketplace lives in the database

## Related Work

- [MCP Marketplace Catalog — First 3 Servers](2026-04-08-152617-mcp-marketplace-catalog-first-3-servers.md) — Initial manual approach (Sessions 1-2)
- [Developer Tools & Database MCP Servers](2026-04-08-161802-t02-developer-tools-database-mcp-servers.md) — Second batch of manual servers (Session 3)
- Previous sessions established the `env_spec` pattern, `${VAR}` interpolation, and HTTP transport support that the automated pipeline now leverages

---

**Status**: Production Ready (pending commit, PR, and integration test)
**Timeline**: Single session (Session 4 of project 20260408.01)
