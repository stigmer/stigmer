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
**Current Task**: T01 complete, pre-T02 infrastructure work complete
**Status**: Complete — ready for T02

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

1. **T02**: Tier 1 Servers — Developer Tools & Databases (GitLab, Linear, Jira, PostgreSQL, SQLite, MySQL, MongoDB)
   - PostgreSQL, Filesystem, and SQLite are now **unblocked** by `${VAR}` arg interpolation
   - Research each server's distribution format (npm, Go, Docker) and env vars before writing
2. **T03**: Tier 1 Servers — Communication & Productivity (Discord, Gmail, Notion, Google Drive, Google Calendar)
3. **T04**: Tier 1 Servers — Cloud, Observability & Utility (AWS, Kubernetes, Sentry, Fetch, Puppeteer)
4. **T05**: Registry Sync Exploration (optional/stretch)

## Context for Resume

- The marketplace template and checklist are in `tasks/T01_1_execution.md`
- The contributor guide is in `seedpack/mcp-servers/CONTRIBUTING.md`
- `${VAR}` interpolation in stdio args is now implemented — servers that take core config as CLI args (PostgreSQL connection URL, Filesystem paths) can now be parameterized per-user through `env_spec`
- Interpolation uses strict mode: missing vars produce clear errors, not silent literal pass-through
- `env_spec` is the universal "what does the server need?" declaration — works the same whether the binary reads values from env vars or CLI args
- `mcp-server-stigmer.yaml` now uses `metadata.tags` (searchable) instead of `spec.tags`
- `github.yaml` now uses the official `github/github-mcp-server` Go binary instead of the deprecated `@modelcontextprotocol/server-github` npm package

## Quick Commands

After loading context:
- "Continue with T02" - Start next batch of server definitions
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
