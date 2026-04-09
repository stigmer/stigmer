# MCP Registry Sync Overhaul: Incremental Sync, Deprecation, and Quality Gates

**Date**: April 9, 2026

## Summary

Overhauled the MCP registry synchronization pipeline across three phases: soft-delete deprecation with downstream filtering, upgrade to the v0.1 registry API with incremental sync support, and a GitHub-only quality gate with star-count filtering. These changes reduce sync overhead from ~11,000 entries per run to only incremental updates (~244/day), eliminate noise from non-GitHub and low-quality servers, and properly handle deprecated servers without breaking existing agent references.

## Problem Statement

The MCP registry sync workflow performed a full crawl of all server versions on every scheduled run, had no mechanism to handle removed or deprecated servers, and ingested everything from the registry regardless of quality or relevance.

### Pain Points

- Every sync fetched all ~11,000 entries (including old versions) even though only ~5,500 latest versions were relevant
- Servers removed from the registry were never detected or marked, leaving stale data in the catalog
- The `stigmer.ai/deprecated` label was set but never read by any downstream component (search, snapshots)
- No quality filtering meant low-effort, unmaintained, and non-GitHub servers polluted the catalog
- Non-deterministic `Instant.now()` calls inside the Temporal workflow violated determinism constraints
- `ObjectMapper` was recreated on every deserialization call
- Cursor parameter was not URL-encoded, risking pagination failures

## Solution

Implemented a three-phase improvement plan:

**Phase 1 — Critical Fixes**: Soft-delete deprecated servers by label and filter them from search results and snapshot builds. Add un-deprecation logic when servers reappear. Fix false-deprecation by tracking seen slugs. Harden deserialization error handling.

**Phase 2 — v0.1 API Upgrade**: Switch from `/v0/servers` to `/v0.1/servers` with `version=latest` for server-side filtering. Introduce `updated_since` parameter backed by a new `mcp_registry_sync_state` MongoDB collection for incremental sync. First run performs a full crawl; subsequent runs fetch only changes.

**Phase 3 — GitHub Quality Gate**: Filter out all non-GitHub servers (~14% of catalog). Add a `FetchGitHubStarsActivity` that batch-queries star counts via the GitHub GraphQL API. Apply a configurable `minGithubStars` threshold (default 10) to skip low-quality servers. Store star counts in the new `github_stars` proto field for downstream use.

## Implementation Details

### Proto Changes (stigmer OSS)
- Added `int32 github_stars = 6` to `McpServerSource` message
- Regenerated stubs across Go, Java, Python, TypeScript, and all SDK codegen targets

### Backend Changes (stigmer-cloud)

**Workflow (`McpRegistrySyncWorkflowImpl`)**:
- Loads `lastSyncedAt` from `SyncStateActivity` to determine incremental vs full crawl
- Filters entries by `repository.source == "github"` before transformation
- Calls `FetchGitHubStarsActivity` per batch and filters by `minGithubStars`
- Sets `github_stars` on each server's `McpServerSource`
- Handles `deleted`/`deprecated` statuses from incremental API responses
- Uses `Workflow.currentTimeMillis()` for deterministic timestamps

**New Activities**:
- `SyncStateActivity` / `SyncStateActivityImpl` — persists and loads `lastSyncedAt` from MongoDB
- `FetchGitHubStarsActivity` / `FetchGitHubStarsActivityImpl` — batch GraphQL queries to GitHub API (100 repos per request)

**Modified Activities**:
- `FetchRegistryPageActivityImpl` — v0.1 API, `version=latest`, `updated_since`, `include_deleted`, URL-encoded cursor
- `MarkDeprecatedServersActivityImpl` — new `markDeprecatedBySlugs` for targeted incremental deprecation, extracted `deprecateServer` helper
- `UpsertMcpServerBatchActivityImpl` — un-deprecation logic when server reappears
- `ResolveSnapshotPackagesActivityImpl` — skip deprecated servers in snapshot builds

**Query Layer**:
- `MongoSearchQueryStore` — excludes `stigmer.ai/deprecated=true` from all search/list queries

**Configuration**:
- `McpServerSyncTemporalConfig` — new `minGithubStars` and `githubToken` fields
- `McpRegistrySyncScheduleRegistrar` — passes `minGithubStars` via workflow memo

## Benefits

- **95%+ reduction in sync volume** on incremental runs (~244 updates/day vs ~11,000 full crawl)
- **14% noise reduction** from filtering non-GitHub servers
- **Quality curation** via star-count threshold eliminates unmaintained or experimental servers
- **Proper lifecycle management** for deprecated servers without breaking existing agent references
- **Deterministic workflow** compliant with Temporal's replay constraints

## Impact

- Search and marketplace results are cleaner — deprecated and low-quality servers are excluded
- Snapshot builds skip deprecated servers, reducing wasted compute
- Sync runs complete faster with less API and database load
- Star counts are available for future ranking and display in the UI

## Related Work

- [MCP Registry Sync Pipeline](_changelog/2026-04/2026-04-08-165622-automated-mcp-registry-sync-pipeline.md)
- [MCP Connect Flow](_changelog/2026-04/2026-04-09-111611-mcp-connect-flow-proto-fga-codegen.md)
- [Polyglot MCP Snapshot Workflow](_changelog/2026-04/2026-04-09-192355-polyglot-mcp-snapshot-workflow.md)

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours
