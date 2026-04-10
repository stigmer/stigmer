# Next Task: 20260410.01.curated-mcp-marketplace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.01.curated-mcp-marketplace

**Description**: Replace the automated MCP Registry sync (temporal workflow) with a hand-curated set of ~33 high-quality MCP server definitions in the seedpack, organized by use-case category. Remove temporal workflow, clean up McpServerSource proto, and create curated YAML files.
**Goal**: Transition from automated bulk-synced MCP servers to a curated, trustworthy marketplace with ~33 hand-picked servers across 11 categories (developer tools, databases, search, cloud, communication, productivity, web automation, monitoring, payments, design, marketing).
**Tech Stack**: Protocol Buffers, YAML, Java/Spring (stigmer-cloud), Go (stigmer CLI)
**Components**: stigmer/seedpack/mcp-servers, stigmer/apis/ai/stigmer/agentic/mcpserver/v1/spec.proto, stigmer-cloud/backend temporal workflow, stigmer CLI (for deletion)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-10
**Status**: In Progress -- Task 1 complete, ready for Task 2
**Last Session**: 2026-04-10 -- Completed Task 1 (cleanup)
**Active Task**: Task 2 (Proto Cleanup + Seedpack Preparation)

## Session Progress (2026-04-10)

### Task 1: COMPLETE
- Deleted 12 synced MCP servers from DB via CLI (preserved system `mcp-server-stigmer`)
- Removed 23 sync-specific Java files from stigmer-cloud (workflows, activities, models, transform)
- Refactored shared Temporal worker/config infrastructure:
  - Renamed `McpServerSyncTemporalConfig` -> `McpServerTemporalConfig` (prefix: `temporal.mcp-server`)
  - Renamed `McpServerSyncTemporalWorkerConfig` -> `McpServerTemporalWorkerConfig`
  - Renamed task queue `mcp_server_sync` -> `mcp_server`
  - Removed `isRegistrySynced()` filter from `ResolveSnapshotPackagesActivityImpl`
  - Removed `TEMPORAL_MCP_SERVER_SYNC_GITHUB_TOKEN` from kustomize
- PR: https://github.com/stigmer/stigmer-cloud/pull/114
- **Manual ops still needed**:
  - Cancel Temporal schedule `mcp-registry-sync-daily` via Temporal UI
  - Delete MongoDB document `mcp-registry-sync-state:stigmer`

### Key Architectural Findings (from Task 1)
- Sync and snapshot workflows were deeply coupled through shared worker config and config properties -- required careful refactoring, not just deletion
- `ResolveSnapshotPackagesActivityImpl` had a `source.registry` filter that would have broken snapshot builds after removing synced servers -- removed entirely so it processes all servers

## Next Steps

1. **Start Task 2**: Proto Cleanup + Seedpack Preparation (stigmer repo)
   - Slim down `McpServerSource` proto (remove 6 sync-only fields)
   - Update `seedpack/mcp-servers/CONTRIBUTING.md` for curated model
   - Verify proto builds
   - PR to stigmer
2. **After Task 2 merges**: Start Task 3 (create ~40 curated YAML files)

## Task Breakdown (3 tasks, each = 1 conversation)

### Task 1: Cleanup -- Delete Synced Data + Remove Temporal Sync Workflow -- COMPLETE
**PR**: https://github.com/stigmer/stigmer-cloud/pull/114

### Task 2: Proto Cleanup + Seedpack Preparation -- NEXT
**Repo**: stigmer
- Slim down McpServerSource proto (remove 6 sync-only fields, keep repository_url + github_stars)
- Update CONTRIBUTING.md for curated contribution model
- Verify proto builds
- PR to stigmer

### Task 3: Create ~40 Curated MCP Server YAML Files
**Repo**: stigmer
- Verify GitHub repo URLs for all servers
- Create YAML files in seedpack/mcp-servers/ (14 categories, ~40 servers)
- Categories: developer tools, databases, search, cloud/infra, communication, productivity, web automation, monitoring, payments, design, AI/reasoning, notifications, scheduling, CRM/support, marketing
- Test seedpack apply
- PR to stigmer

## Quick Commands

After loading context:
- "Start Task 2" -- begin proto cleanup
- "Start Task 3" -- begin curated YAML creation
- "Show project status" -- overview of progress

## Key References

- **Detailed plan**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/tasks/T01_0_plan.md`
- **Task 1 execution plan**: Cursor plan `mcp_sync_workflow_cleanup_1ed74fe3.plan.md`
- **Task 1 PR**: https://github.com/stigmer/stigmer-cloud/pull/114
- **Existing MCP server YAML template**: `seedpack/mcp-servers/mcp-server-stigmer.yaml`
- **Proto file**: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`
- **Temporal workflow dir (post-cleanup)**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/temporal/` (13 files remaining)

---

*Drop this file into a new conversation to resume work on this project.*
