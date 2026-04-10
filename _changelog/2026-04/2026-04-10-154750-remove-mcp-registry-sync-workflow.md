# Remove MCP Registry Sync Workflow

**Date**: April 10, 2026

## Summary

Removed the automated MCP Registry sync Temporal workflow from stigmer-cloud and refactored the shared Temporal infrastructure so the BuildMcpSnapshot workflow continues to operate cleanly on a renamed task queue. This is the first step in transitioning from automated bulk-synced MCP servers to a curated, hand-picked marketplace.

## Problem Statement

The MCP Registry sync workflow pulled ~5,000 servers from `registry.modelcontextprotocol.io`, quality-filtered by GitHub stars, and bulk-upserted into the database. This automated approach had fundamental problems that couldn't be solved by tuning the pipeline.

### Pain Points

- Too many low-value servers landed on the platform despite star-based filtering
- No editorial control over what appeared in the marketplace
- Raw registry metadata with inconsistent naming and descriptions
- The workflow hit Temporal's 50MB workflow history limit, requiring continueAsNew workarounds
- GitHub API rate limiting added operational complexity (token management, retry logic)
- Quality grading was coarse (star thresholds don't capture utility or reliability)

## Solution

Remove the sync workflow entirely and replace with a curated model where MCP servers are hand-picked, reviewed, and maintained as YAML files in the seedpack. This PR handles the cleanup; curated YAML creation follows in a separate task.

## Implementation Details

### Runtime Cleanup

- Deleted 12 synced MCP servers from the live database via CLI
- Preserved the system `mcp-server-stigmer` server (labeled `stigmer.ai/system: "true"`)

### Code Removal (23 files, ~1,900 lines)

| Category | Files | Description |
|----------|-------|-------------|
| Workflows | 5 | `McpRegistrySyncWorkflow`, input/result/stats DTOs |
| Activities | 10 | FetchRegistryPage, FetchGitHubMetricsBatch, UpsertMcpServerBatch, MarkDeprecatedServers, SyncState (interface + impl each) |
| Models | 5 | GitHubRepoGrade, GitHubRepoMetrics, RegistryPage, RegistryPageResult, RegistryServerEntry |
| Transform | 1 | McpRegistryTransformer (registry-to-proto mapper) |
| Config | 2 | McpRegistrySyncScheduleRegistrar, McpServerSyncTemporalWorkflowTypes |

### Shared Infrastructure Refactoring

The sync and snapshot workflows were deeply coupled through shared Temporal infrastructure. Untangling this was the critical architectural work:

- **Config**: `McpServerSyncTemporalConfig` (79 lines, 10 fields) replaced with `McpServerTemporalConfig` (28 lines, 1 field). The 9 sync-specific fields (registryBaseUrl, pageSize, orgId, scheduleCron, githubToken, star thresholds, stale thresholds) were removed. Config prefix changed from `temporal.mcp-server-sync` to `temporal.mcp-server`.

- **Worker**: `McpServerSyncTemporalWorkerConfig` (71 lines) replaced with `McpServerTemporalWorkerConfig` (48 lines). Removed 5 sync-specific activity injections, kept only `ResolveSnapshotPackagesActivityImpl`. Removed `McpRegistrySyncWorkflowImpl` registration.

- **Task queue**: Renamed from `mcp_server_sync` to `mcp_server` since it now only serves the snapshot workflow.

- **Snapshot filter**: `ResolveSnapshotPackagesActivityImpl.isRegistrySynced()` was removed entirely. The method filtered servers by `source.registry` being non-empty, which would have silently broken snapshot builds after removing synced data. The snapshot builder now processes all non-deprecated servers with stdio configs.

- **YAML config**: Added explicit `temporal.mcp-server.task-queue` entry to `application-temporal.yaml` for discoverability.

- **Kustomize**: Removed `TEMPORAL_MCP_SERVER_SYNC_GITHUB_TOKEN` env var (only used by sync workflow's GitHub quality grading).

## Benefits

- **Cleaner codebase**: 1,900 lines of sync infrastructure removed, temporal package reduced from 33 to 13 files
- **Simpler operations**: No more GitHub API token management, rate limiting, or Temporal history size concerns
- **Editorial control**: Path cleared for curated marketplace with hand-picked, reviewed servers
- **More reliable snapshots**: Snapshot builder now processes all servers instead of only registry-synced ones

## Impact

- **stigmer-cloud backend**: 35 files changed (+103 / -1,966 lines)
- **Temporal infrastructure**: Task queue renamed, `mcp-registry-sync-daily` schedule must be cancelled
- **MongoDB**: Orphan `mcp-registry-sync-state:stigmer` document to be manually deleted
- **Kustomize/ops**: GitHub API token env var removed from deployment config

## Related Work

- Part of project `20260410.01.curated-mcp-marketplace`
- Task 2 (proto cleanup) and Task 3 (curated YAML creation) follow
- PR: https://github.com/stigmer/stigmer-cloud/pull/114

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
