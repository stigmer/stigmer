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
- **Last Session**: 2026-02-23 — Completed Phase 2 (Bootstrap Integration) + Phase 3 (Server Wiring)
- **Active Task**: Phase 4 (Daemon Auto-Start) — not yet started

## Session Progress (2026-02-22)

- Reviewed and approved T01 plan
- Implemented Phase 1: Added MCP server as a third resource type in the seedpack
- Created `mcp-servers/stigmer-mcp-server.yaml` with proto-compliant YAML definition
- Extended `Manifest` struct with `McpServers` field, added `LoadMcpServerYAML()` and `GetMcpServerByName()`
- Updated `embed.go`, `BUILD.bazel`, `manifest.json` (schema v3, version 1.2.0)
- Added 4 new tests, updated existing assertions — all pass
- Bootstrap tests also pass with the version bump

## Session Progress (2026-02-23)

- Discovered the downstream mcpserver client was missing an `Apply` method (proto and controller had it, client wrapper did not)
- Added `Apply` method to downstream mcpserver client following the agent client pattern
- Extended `bootstrap.go` with full MCP server bootstrap support:
  - Added `McpServerClient` interface
  - Added `KeyMcpServerPrefix = "mcpserver:"` state key
  - Added `mcpServerClient` field to `Bootstrapper` struct
  - Updated `NewBootstrapper` to accept 4th `McpServerClient` parameter
  - Added `bootstrapMcpServer()` method following `bootstrapAgent` pattern exactly
  - Added `calculateMcpServerHash()` for content-based change detection
  - Updated `Run()` with MCP server loop and error tracking
  - Updated package doc comment
- Updated `BUILD.bazel` with mcpserver proto dependency
- Wired `mcpServerClient` into `NewBootstrapper` call in `server.go` (Phase 3 — combined since it was a single-line change)
- Updated all 7 existing test cases for new constructor signature
- Added `MockMcpServerClient`, `TestBootstrapper_Run_DegradedMode_McpServerError`, `TestCalculateMcpServerHash`
- All 9 tests pass, all 3 bazel build targets succeed

## Next Steps

1. **Phase 4: Daemon Auto-Start** — Start MCP server subprocess alongside Stigmer server
   - Start `stigmer mcp-server` as a managed subprocess after server is healthy
   - PID file tracking, log output, graceful shutdown coordination
   - Open question: Daemon vs Server supervisor — recommended daemon for STDIO isolation
   - Open question: Auto-start ALL bootstrapped MCP servers or only the built-in one?
2. **Phase 5: Tests & Validation** — End-to-end verification

## Context for Resume

- The seedpack package lives at `backend/services/stigmer-server/pkg/seedpack/`
- Phase 1 followed the existing agent pattern: `AgentEntry` -> `McpServerEntry`, `LoadAgentYAML` -> `LoadMcpServerYAML`
- Phase 2 followed the existing agent pattern: `AgentClient` -> `McpServerClient`, `bootstrapAgent` -> `bootstrapMcpServer`
- The `parseMcpServerYAML` function mirrors `parseAgentYAML` — not generified, deliberate choice for two resource types
- The MCP server YAML uses STDIO transport: `command: stigmer`, `args: [mcp-server]`
- The downstream mcpserver client now has `Apply` (added in Phase 2) alongside existing `Create`, `Update`, `Delete`
- `calculateMcpServerHash` hashes: name, description, transport config (command+args or url), and tags
- Pre-existing `TestVerifyContentDigest` failure (package_skill.py digest mismatch) — unrelated to this work
- Phase 2 plan is at `.cursor/plans/phase_2_bootstrap_mcp_1711ecc1.plan.md`

## Quick Commands

After loading context:
- "Continue with Phase 4" — Start daemon auto-start integration
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review the T01 plan" — Check the full implementation plan

---

*This file provides direct paths to all project resources for quick context loading.*
