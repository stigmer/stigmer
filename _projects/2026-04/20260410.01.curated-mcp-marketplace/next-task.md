# Next Task: 20260410.01.curated-mcp-marketplace

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260410.01.curated-mcp-marketplace

**Description**: Replace the automated MCP Registry sync (temporal workflow) with a hand-curated set of high-quality MCP server definitions in the seedpack, organized by use-case category. Remove temporal workflow, clean up McpServerSource proto, and create curated YAML files.
**Goal**: Transition from automated bulk-synced MCP servers to a curated, trustworthy marketplace with 36 hand-picked servers across 14 categories.
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

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260410.01.curated-mcp-marketplace/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-10
**Status**: All 3 Tasks COMPLETE -- Ready for end-to-end testing
**Last Session**: 2026-04-10 -- Completed Task 3 (curated MCP server YAML files)
**Active Task**: None -- all implementation complete, pending live validation

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
- Regenerated all stubs across both repos
- Rewrote `seedpack/mcp-servers/CONTRIBUTING.md` for curated marketplace model
- **Design decision**: Flattened rather than keeping 2-field wrapper

### Task 3: COMPLETE
- Created 36 curated MCP server YAML files across 14 categories
- All 37 files (36 new + existing stigmer) validated through protojson loader with strict parsing
- Updated CONTRIBUTING.md with multi-transport templates and corrected tags placement
- PR: https://github.com/stigmer/stigmer/pull/115

**Transport breakdown:**
- stdio via npx: 20 servers (Node.js packages)
- stdio via uvx: 5 servers (Python: Redis, PostgreSQL, AWS x3)
- stdio via go run: 2 servers (Go: GitHub, Terraform)
- HTTP hosted: 9 servers (GitLab, Linear, Slack, Notion, Google Maps, Figma, Atlassian)

**Key discoveries during Task 3:**
- The `modelcontextprotocol/servers` monorepo (83K stars) archived most reference servers as of May 2025. Only 6 remain active: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking.
- Sourced official first-party replacements from vendors: Brave, Sentry, Slack, GitLab, Google Maps, Atlassian now have their own servers.
- Dropped 6 from original plan: Docker MCP Gateway (requires Docker engine), Google Drive (no quality replacement), Puppeteer (redundant with Playwright), LinkedIn (TOS risk), Zendesk (low quality), Shopify (404 repo).

### Key Architectural Findings (from Task 1)
- Sync and snapshot workflows were deeply coupled through shared worker config and config properties -- required careful refactoring, not just deletion
- `ResolveSnapshotPackagesActivityImpl` had a `source.registry` filter that would have broken snapshot builds after removing synced servers -- removed entirely so it processes all servers

## Next Steps

1. **Merge PRs**: Merge Task 2 changes (stigmer, if not already merged) and Task 3 PR (#115)
2. **Test end-to-end**: Run `stigmer seedpack apply` against a live environment, verify all 36 servers appear in marketplace with correct metadata
3. **Manual ops** (from Task 1): Cancel Temporal schedule, delete MongoDB sync state document
4. **Verify marketplace UX**: Check the marketplace UI displays categories, tags, and transport configs correctly

## Task Breakdown (3 tasks -- ALL COMPLETE)

### Task 1: Cleanup -- Delete Synced Data + Remove Temporal Sync Workflow -- COMPLETE
**PR**: https://github.com/stigmer/stigmer-cloud/pull/114

### Task 2: Proto Cleanup + Seedpack Preparation -- COMPLETE
**Repo**: stigmer + stigmer-cloud (stubs only)

### Task 3: Create Curated MCP Server YAML Files -- COMPLETE
**Repo**: stigmer
**PR**: https://github.com/stigmer/stigmer/pull/115

## Key References

- **Detailed plan**: `_projects/2026-04/20260410.01.curated-mcp-marketplace/tasks/T01_0_plan.md`
- **Task 1 PR**: https://github.com/stigmer/stigmer-cloud/pull/114
- **Task 3 PR**: https://github.com/stigmer/stigmer/pull/115
- **Proto file**: `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`
- **CONTRIBUTING guide**: `seedpack/mcp-servers/CONTRIBUTING.md`

---

*Drop this file into a new conversation to resume work on this project.*
