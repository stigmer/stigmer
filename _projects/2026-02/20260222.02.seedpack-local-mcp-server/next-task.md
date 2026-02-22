# Next Task: 20260222.02.seedpack-local-mcp-server

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260222.02.seedpack-local-mcp-server

**Description**: Add a default local MCP server resource to the seedpack that gets bootstrapped and started alongside the Stigmer server when running 'stigmer server'. The MCP server will use STDIO transport and be available by default alongside the existing skill-creator skill and skill-creator-agent.
**Goal**: When 'stigmer server' starts, a local MCP server is also automatically started and available, configured via the seedpack bootstrap process.
**Tech Stack**: Go (backend server, CLI, seedpack, MCP server)
**Components**: seedpack package, bootstrap process, daemon startup, MCP server, CLI server command

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-02/20260222.02.seedpack-local-mcp-server/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current State

- **Status**: In Progress
- **Last Session**: 2026-02-22 — Completed Phase 1 (Seedpack MCP Server Resource)
- **Active Task**: Phase 2 (Bootstrap Integration) — not yet started

## Session Progress (2026-02-22)

- Reviewed and approved T01 plan
- Implemented Phase 1: Added MCP server as a third resource type in the seedpack
- Created `mcp-servers/stigmer-mcp-server.yaml` with proto-compliant YAML definition
- Extended `Manifest` struct with `McpServers` field, added `LoadMcpServerYAML()` and `GetMcpServerByName()`
- Updated `embed.go`, `BUILD.bazel`, `manifest.json` (schema v3, version 1.2.0)
- Added 4 new tests, updated existing assertions — all pass
- Bootstrap tests also pass with the version bump

## Next Steps

1. **Phase 2: Bootstrap Integration** — Extend `bootstrap.go` to apply MCP server resources from the seedpack on startup
   - Add `McpServerClient` interface
   - Add `bootstrapMcpServer()` method
   - Update `Bootstrapper` constructor and `Run()` to iterate `manifest.McpServers`
2. **Phase 3: Server Wiring** — Create in-process MCP server client and pass to bootstrapper
3. **Phase 4: Daemon Auto-Start** — Start MCP server subprocess alongside Stigmer server
4. **Phase 5: Tests & Validation**

## Context for Resume

- The seedpack package lives at `backend/services/stigmer-server/pkg/seedpack/` (relocated from `backend/libs/go/seedpack/` in a prior session)
- Phase 1 followed the existing agent pattern exactly: `AgentEntry` -> `McpServerEntry`, `LoadAgentYAML` -> `LoadMcpServerYAML`
- The `parseMcpServerYAML` function mirrors `parseAgentYAML` — not generified, deliberate choice for two resource types
- The MCP server YAML uses STDIO transport: `command: stigmer`, `args: [mcp-server]`
- Pre-existing `TestVerifyContentDigest` failure (package_skill.py digest mismatch) — unrelated to this work
- Open question from T01 plan: Daemon vs Server supervisor for MCP server process — recommended daemon for STDIO isolation

## Quick Commands

After loading context:
- "Continue with Phase 2" — Start bootstrap integration
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review the T01 plan" — Check the full implementation plan

---

*This file provides direct paths to all project resources for quick context loading.*
