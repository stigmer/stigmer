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
**Status**: In Progress -- Tasks 1 and 2 complete, ready for Task 3
**Last Session**: 2026-04-10 -- Completed Task 2 (proto cleanup + seedpack preparation)
**Active Task**: Task 3 (Create Curated MCP Server YAML Files)

## Session Progress (2026-04-10)

### Task 1: COMPLETE
- Deleted 12 synced MCP servers from DB via CLI (preserved system `mcp-server-stigmer`)
- Removed 23 sync-specific Java files from stigmer-cloud (workflows, activities, models, transform)
- Refactored shared Temporal worker/config infrastructure
- PR: https://github.com/stigmer/stigmer-cloud/pull/114
- **Manual ops still needed**:
  - Cancel Temporal schedule `mcp-registry-sync-daily` via Temporal UI
  - Delete MongoDB document `mcp-registry-sync-state:stigmer`

### Task 2: COMPLETE
- Deleted entire `McpServerSource` message from `spec.proto` (8 fields removed, no reserved)
- Promoted `repository_url` (field 12) and `github_stars` (field 13) directly onto `McpServerSpec`
- Removed `source` field (field 10) from `McpServerSpec`
- Removed unused `google/protobuf/timestamp.proto` import
- Regenerated all stubs across both repos:
  - stigmer: `make codegen` (Go, Java, Python, TS stubs + JSON schemas + SDK codegen + SDK docs + narration)
  - stigmer-cloud: `make protos` (Java, Go, Python, TS, Dart stubs)
- Rewrote `seedpack/mcp-servers/CONTRIBUTING.md` for curated marketplace model (naming conventions, YAML template, quality bar, 14 categories)
- Verified: `buf lint` clean, zero stale references to `McpServerSource` or removed fields
- Net: 25 files changed, -3,346 lines deleted, +731 lines added (stigmer), 13 files changed in stigmer-cloud
- **Design decision**: Flattened rather than keeping 2-field wrapper -- simpler YAML for curated entries, safe because all synced data was already deleted in Task 1

### Key Architectural Findings (from Task 1)
- Sync and snapshot workflows were deeply coupled through shared worker config and config properties -- required careful refactoring, not just deletion
- `ResolveSnapshotPackagesActivityImpl` had a `source.registry` filter that would have broken snapshot builds after removing synced servers -- removed entirely so it processes all servers

## Next Steps

1. **Start Task 3**: Create ~40 Curated MCP Server YAML Files (stigmer repo)
   - Verify GitHub repo URLs for all servers
   - Create YAML files in `seedpack/mcp-servers/` (14 categories, ~40 servers)
   - Test `stigmer seedpack apply`
   - PR to stigmer
2. **After Task 3**: Test end-to-end marketplace experience

## Task Breakdown (3 tasks, each = 1 conversation)

### Task 1: Cleanup -- Delete Synced Data + Remove Temporal Sync Workflow -- COMPLETE
**PR**: https://github.com/stigmer/stigmer-cloud/pull/114

### Task 2: Proto Cleanup + Seedpack Preparation -- COMPLETE
**Repo**: stigmer + stigmer-cloud (stubs only)
- Deleted `McpServerSource` message entirely, flattened `repository_url` + `github_stars` onto `McpServerSpec`
- Rewrote CONTRIBUTING.md for curated contribution model
- Regenerated all stubs in both repos

### Task 3: Create ~40 Curated MCP Server YAML Files -- NEXT
**Repo**: stigmer
- Verify GitHub repo URLs for all servers
- Create YAML files in seedpack/mcp-servers/ (14 categories, ~40 servers)
- Categories: developer tools, databases, search, cloud/infra, communication, productivity, web automation, monitoring, payments, design, AI/reasoning, notifications, scheduling, CRM/support, marketing
- Test seedpack apply
- PR to stigmer

## Quick Commands

After loading context:
- "Start Task 3" -- begin curated YAML creation
- "Show project status" -- overview of progress

## Key References

- **Detailed plan**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/tasks/T01_0_plan.md`
- **Task 1 PR**: https://github.com/stigmer/stigmer-cloud/pull/114
- **Existing MCP server YAML template**: `seedpack/mcp-servers/mcp-server-stigmer.yaml`
- **Proto file**: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`
- **CONTRIBUTING guide**: `seedpack/mcp-servers/CONTRIBUTING.md`
- **Temporal workflow dir (post-cleanup)**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/mcpserver/temporal/` (13 files remaining)

---

*Drop this file into a new conversation to resume work on this project.*
