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
- **Last Session**: 2026-02-23 — Made agent-runner a generic STDIO MCP runtime; published Go module; rewrote docs
- **Active Task**: Post-merge tagging (`mcp-server/v0.1.0`)

## Session Progress (2026-02-22)

- Reviewed and approved T01 plan
- Implemented Phase 1: Added MCP server as a third resource type in the seedpack
- Created `mcp-servers/stigmer-mcp-server.yaml` with proto-compliant YAML definition
- Extended `Manifest` struct with `McpServers` field, added `LoadMcpServerYAML()` and `GetMcpServerByName()`
- Updated `embed.go`, `BUILD.bazel`, `manifest.json` (schema v3, version 1.2.0)
- Added 4 new tests, updated existing assertions — all pass
- Bootstrap tests also pass with the version bump

## Session Progress (2026-02-23, Session 2)

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

## Session Progress (2026-02-23, Session 3)

- Shifted MCP server execution model: baked-in binary -> dynamic subprocess via runtime tools
- Published `apis/stubs/go` sub-module as `v0.0.1`, removed `replace` directive from `mcp-server/go.mod`
- Refactored agent-runner Dockerfile: removed Go builder stage for stigmer CLI, added Docker CLI + Go toolchain + uv/uvx
- Updated seedpack YAML to use `go run github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest`
- Bumped seedpack version 1.2.0 -> 1.3.0
- Rewrote `mcp-server/README.md` with Go install, Docker, per-IDE client configs (modeled after GitHub MCP Server)
- Updated main `README.md` with MCP Servers section
- Fixed all test assertions; all tests pass
- Committed as `83e2419e`

## Next Steps

1. **Post-merge: Tag `mcp-server/v0.1.0`** — After changes land on `main`, tag the merge commit so `go run …@latest` resolves correctly
   ```bash
   git tag mcp-server/v0.1.0 <merge-commit-sha>
   git push origin mcp-server/v0.1.0
   ```
2. **Verify remote `go install`** — Confirm the Go module proxy indexes the new version
3. **Phase 4: Daemon/Agent-Runner MCP subprocess management** — If still needed, implement the actual subprocess lifecycle (start, monitor, restart, shutdown) in the agent-runner

## Context for Resume

- The seedpack package lives at `backend/services/stigmer-server/pkg/seedpack/`
- Phase 1 followed the existing agent pattern: `AgentEntry` -> `McpServerEntry`, `LoadAgentYAML` -> `LoadMcpServerYAML`
- Phase 2 followed the existing agent pattern: `AgentClient` -> `McpServerClient`, `bootstrapAgent` -> `bootstrapMcpServer`
- The `parseMcpServerYAML` function mirrors `parseAgentYAML` — not generified, deliberate choice for two resource types
- The MCP server YAML now uses `command: go, args: [run, github.com/stigmer/stigmer/mcp-server/cmd/mcp-server-stigmer@latest]`
- The downstream mcpserver client has `Apply` (added in Session 2) alongside existing `Create`, `Update`, `Delete`
- `calculateMcpServerHash` hashes: name, description, transport config (command+args or url), and tags
- The agent-runner image now has: node/npm/npx, go, docker, uv/uvx — all verified in Dockerfile build
- `apis/stubs/go` tagged as `v0.0.1` on commit `00f12c70` (main branch)
- Pre-existing `TestVerifyContentDigest` failure (package_skill.py digest mismatch) — unrelated to this work

## Blockers

- **`mcp-server/v0.1.0` tag**: Cannot tag until changes are merged to `main`. Until then, `go run …@latest` will resolve to the old version with the `replace` directive (which will fail). This is expected and will self-resolve after merge + tag.

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-02/20260222.02.seedpack-local-mcp-server/next-task.md`

## Quick Commands

After loading context:
- "Tag mcp-server/v0.1.0" — After merge, tag the module
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review the T01 plan" — Check the full implementation plan

---

*This file provides direct paths to all project resources for quick context loading.*
