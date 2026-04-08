# Next Task: 20260408.01.mcp-marketplace-catalog

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260408.01.mcp-marketplace-catalog

**Description**: Populate the Stigmer MCP marketplace with well-crafted McpServer resource definitions for popular public MCP servers. Each definition includes proper env_spec, default_tool_approvals, tags, icons, and discovered_capabilities — giving platform builders immediate utility out of the box.
**Goal**: Create 15-20 high-quality McpServer YAML definitions for the most popular MCP servers (GitHub, PostgreSQL, Slack, Filesystem, Brave Search, etc.), decide where the catalog lives, and establish the workflow for adding new servers.
**Tech Stack**: Protobuf/YAML (McpServer resource definitions), Go (CLI discovery tooling), MCP Registry REST API
**Components**: seedpack/ (existing MCP server definitions), apis/ai/stigmer/agentic/mcpserver/ (proto definitions), client-apps/cli/ (discovery commands)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260408.01.mcp-marketplace-catalog/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-08 08:56
**Current Task**: Automated MCP Registry sync pipeline — implementation complete, pending commit + PR
**Status**: In progress — code complete, needs commit/PR/test

## Session Progress (2026-04-08, Session 1)

- Studied McpServer proto schema (6 proto files) and existing `mcp-server-stigmer.yaml`
- Established marketplace YAML template and merge checklist
- Confirmed design decisions: naming (upstream), org (omit), tags (`metadata.tags` only), labels (`stigmer.ai/category`)
- Discovered surprise: PostgreSQL/Filesystem use positional args not env vars — swapped for Brave Search + Slack
- Wrote 3 marketplace McpServer YAMLs: `github.yaml`, `brave-search.yaml`, `slack.yaml`
- All 3 pass `stigmer validate`
- Wrote contributor guide: `seedpack/mcp-servers/CONTRIBUTING.md`
- Changed `mcp-server-stigmer.yaml` from `@v0.0.52` to `@latest` (user decision: no version pinning)
- User removed `default_tool_approvals` from `mcp-server-stigmer.yaml` (intentional)

## Session Progress (2026-04-08, Session 2)

- Resolved all 3 open questions from Session 1
- Added `${VAR}` interpolation to stdio args in agent-runner `config_transformer.py` (strict mode)
- Fixed `mcp-server-stigmer.yaml`: moved `spec.tags` to `metadata.tags` (now searchable)
- Updated `github.yaml`: switched from deprecated npm package to official `github/github-mcp-server` Go binary via `go run`
- Added `GITHUB_HOST` and `GITHUB_TOOLSETS` env_spec entries to `github.yaml`
- Updated proto docs on `StdioServerConfig.args` to document `${VAR}` syntax
- Updated `CONTRIBUTING.md` with arg interpolation docs and security note
- 10 new unit tests — all 42 config transformer tests pass, all 58 placeholder resolver tests pass

## Next Steps

1. **T03**: Tier 1 Servers — Communication & Productivity (Discord, Gmail, Notion, Google Drive, Google Calendar)
2. **T04**: Tier 1 Servers — Cloud, Observability & Utility (AWS, Kubernetes, Sentry, Fetch, Puppeteer)
3. **T05**: Registry Sync Exploration (optional/stretch)

## Context for Resume

- The marketplace template and checklist are in `tasks/T01_1_execution.md`
- The contributor guide is in `seedpack/mcp-servers/CONTRIBUTING.md`
- `${VAR}` interpolation in stdio args is now implemented — servers that take core config as CLI args (PostgreSQL connection URL, Filesystem paths) can now be parameterized per-user through `env_spec`
- Interpolation uses strict mode: missing vars produce clear errors, not silent literal pass-through
- `env_spec` is the universal "what does the server need?" declaration — works the same whether the binary reads values from env vars, CLI args, or HTTP headers
- `mcp-server-stigmer.yaml` now uses `metadata.tags` (searchable) instead of `spec.tags`
- `github.yaml` now uses the official `github/github-mcp-server` Go binary instead of the deprecated `@modelcontextprotocol/server-github` npm package
- T02 introduced two new transport patterns: `spec.http` (Linear, Atlassian) and `uvx` command (PostgreSQL, SQLite)
- `CONTRIBUTING.md` updated with HTTP server template and uvx runtime examples
- Seedpack now has 11 total MCP server definitions across 3 transport types

## Session Progress (2026-04-08, Session 3)

- Researched 7 MCP servers: Linear, Atlassian, MongoDB, MySQL, GitLab, PostgreSQL, SQLite
- Discovered 5 surprises requiring design decisions:
  1. Linear and Atlassian (Jira) are HTTP-only remote servers — no stdio npm packages exist
  2. The reference `@modelcontextprotocol/server-postgres` is archived with a known SQL injection vulnerability
  3. Official SQLite MCP server is Python-only (uvx, not npx)
  4. GitLab npm package source removed from `modelcontextprotocol/servers` main branch (still published on npm by GitLab PBC)
  5. No official MySQL MCP server exists — best option is community `@benborla29/mcp-server-mysql`
- All 5 decisions resolved collaboratively:
  - Linear + Atlassian: use `spec.http` with Bearer token auth (first HTTP servers in seedpack)
  - PostgreSQL: use `crystaldba/postgres-mcp` (Python/uvx) — `DATABASE_URI` env var, restricted mode with SQL injection protections
  - SQLite: confirmed `uvx` available in agent-runner Dockerfile
  - GitLab: use npm package via npx (works with any GitLab tier, not just Premium)
  - MySQL: community package accepted
- Wrote 7 new McpServer YAMLs — all pass `stigmer validate`:
  - HTTP: `linear.yaml`, `atlassian.yaml`
  - npx stdio: `mongodb.yaml`, `mysql.yaml`, `gitlab.yaml`
  - uvx stdio: `postgresql.yaml`, `sqlite.yaml`
- Added `default_tool_approvals` for MongoDB (drop-database, drop-collection, delete-many), GitLab (create_or_update_file, push_files, fork_repository), SQLite (write_query, create_table)
- Updated `CONTRIBUTING.md`: added HTTP server template, uvx runtime examples, updated env_spec docs for 3 delivery mechanisms

### Decisions Made

| Decision | Resolution | Rationale |
|----------|------------|-----------|
| Add `spec.http` servers? | Yes — Linear and Atlassian | Agent-runner already supports `streamable_http`. Exercises the full platform. |
| PostgreSQL package? | `crystaldba/postgres-mcp` (Python/uvx) | 2.4k stars, MIT, `DATABASE_URI` env var, restricted mode with pglast SQL protections. Reference server archived + vulnerable. |
| SQLite runtime? | `uvx` (Python) | Agent-runner Dockerfile installs `uv`/`uvx`. |
| GitLab approach? | npm package via npx | Published by GitLab PBC, not deprecated. HTTP requires Premium/Ultimate + Duo. |
| MySQL community pkg? | Yes — `@benborla29/mcp-server-mysql` | 1.4k stars, read-only by default. No official alternative. |
| Atlassian scope? | `atlassian` (not `jira`) | Official endpoint covers Jira + Confluence + Compass. |
| Atlassian auth? | Bearer (service account API key) | Basic auth requires base64 encoding which doesn't fit `${VAR}` model cleanly. |

## Session Progress (2026-04-08, Session 4)

- **Major pivot**: Replaced manual YAML authoring (T03/T04/T05) with automated MCP Registry sync pipeline
- Researched official MCP Registry API (`registry.modelcontextprotocol.io/v0/servers`) and 5 alternative directories
- Concluded official registry is the only Phase 1 source with a structured REST API
- **stigmer OSS changes** (12 files):
  - Added `McpServerSource` message + `source` field (field 10) to `McpServerSpec` proto
  - Deleted 10 handcrafted marketplace YAMLs from `seedpack/mcp-servers/`
  - Updated `CONTRIBUTING.md` to reflect automated sync model
- **stigmer-cloud changes** (16 new Java files + regenerated stubs):
  - Full Temporal workflow: `McpRegistrySyncWorkflow` with 3 activities
  - `FetchRegistryPageActivity`: paginated HTTP GET to registry API
  - `UpsertMcpServerBatchActivity`: batch upsert with spec merge (preserves `default_tool_approvals`, `default_enabled_tools`, `discovered_capabilities`)
  - `MarkDeprecatedServersActivity`: labels removed servers as `stigmer.ai/deprecated`
  - `McpRegistryTransformer`: registry JSON → McpServer proto mapping (stdio/http, env vars, icons)
  - Temporal Schedule registrar for daily cron execution
  - Worker config wiring all components

### Key Decisions (Session 4)

| Decision | Rationale |
|----------|-----------|
| Temporal workflow over CLI command | Scheduled, reliable, observable, no manual trigger |
| Official MCP Registry only (Phase 1) | Only source with structured REST API |
| DB-only catalog (not seedpack) | Seedpack is compile-time; DB is for continuously-updated catalog |
| Delete handcrafted YAMLs | Will be auto-synced from registry |
| Deprecation via label | Servers removed from registry get labeled, not deleted |
| Preserve curated fields on upsert | Sync never overwrites `default_tool_approvals`, `default_enabled_tools`, or `discovered_capabilities` |

## Next Steps

1. **Commit changes** in both repos (stigmer OSS + stigmer-cloud)
2. **Create PRs** for both repos
3. **Regenerate proto stubs** to pick up `McpServerSource` (already done in stigmer-cloud)
4. **Test sync workflow** locally or in staging — verify end-to-end flow
5. **Post-launch**: Add manual curation layer for `default_tool_approvals` and category labels
6. **Future**: Consider additional sources (Smithery, if they add a public API)

## Context for Resume

- The sync pipeline is fully implemented but not yet committed or tested
- **stigmer OSS** has uncommitted changes: proto change + seedpack cleanup (12 files)
- **stigmer-cloud** has uncommitted changes: new temporal package + regenerated stubs (21 files)
- The `identityprovider` stubs in stigmer-cloud were regenerated alongside mcpserver stubs — may be from a concurrent change; verify before committing
- Previous chat: [MCP Marketplace Catalog](8873560d-13ec-473d-ad14-440423338b58)

## Blockers

None — all code is written and design decisions resolved.

## Quick Commands

After loading context:
- "Commit and PR" - Commit changes in both repos and create PRs
- "Test sync workflow" - Verify the Temporal workflow end-to-end
- "Show project status" - Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
