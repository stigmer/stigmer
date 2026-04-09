# Next Task: 20260409.01.mcp-server-sandbox-security

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260409.01.mcp-server-sandbox-security

**Description**: Move stdio MCP server execution from the agent-runner pod into the Daytona sandbox for security isolation, and automate snapshot management with pre-installed MCP server packages. Addresses the risk of running untrusted marketplace MCP servers inside the control plane container.
**Goal**: Isolate stdio MCP server execution in Daytona sandboxes (same sandbox used for workspace), automate snapshot lifecycle with popular MCP servers pre-installed, and clean up the agent-runner Dockerfile to no longer bundle MCP runtimes.
**Tech Stack**: Python (agent-runner, Graphton), Daytona SDK (Image, SnapshotService, Process API), Temporal workflows
**Components**: agent-runner (worker/mcp/, worker/activities/, sandbox Dockerfiles, config.py, sandbox_manager.py), Graphton middleware (core/middleware.py, core/mcp_manager.py), agent-runner Dockerfile

## Current State
- **Status**: COMPLETE — all tasks (T01-T04) done, security boundary closed
- **Last Session**: 2026-04-09 (Session 4) — T04 implemented and tested
- **Active Task**: T01 COMPLETE. T02 COMPLETE. T03 COMPLETE. T04 COMPLETE.
- **Branch**: `feat/mcp-server-sandbox-security`

## Session Progress (2026-04-09, Session 4)

### T04: Connect/Discover Sandboxing + Agent-Runner Dockerfile Cleanup — COMPLETE

Four sub-scopes executed:

1. **Sandbox-aware discovery** — Modified `discover_mcp_server.py` to create ephemeral Daytona sandboxes for stdio MCP servers in cloud mode. Added `_maybe_create_discovery_sandbox()` (three-way gating: local→None, cloud+HTTP→None, cloud+stdio→sandbox) and `_cleanup_discovery_sandbox()` (immediate deletion in `finally` block). Updated `_connect_and_discover()` to accept optional `sandbox` parameter, routing stdio through `DaytonaMCPClient` when present.

2. **Dockerfile cleanup** — Removed Node.js/npm/npx, Go toolchain, uv/uvx, gnupg, MCP runtime verification step, and Go cache directories from the agent-runner Dockerfile. Replaced with minimal system deps (git, ca-certificates, curl). Image is now a pure Python orchestrator.

3. **Documentation** — Added "MCP Server Execution in Cloud Mode" section to `execution-modes.md` covering agent execution path, connect/discover workflow, Dockerfile changes, and local mode. Added "Automated Snapshot Management (Production)" section to `daytona-setup.md`.

4. **Tests** — Added 13 new tests in `test_discover_mcp_sandbox.py`: gating logic (5), client routing (4), cleanup (2), timeout budget (2). Full suite: **1499 passed**, 21 skipped, 0 failures.

### Design Decision: Ephemeral Sandbox for Discovery
Chose Option A (ephemeral sandbox per discovery) over Option B (deferred backfill). Rationale: preserves immediate UX (tools visible at connect time), enables classify_tool_approvals at connect time, mirrors Cursor's immediate-discovery pattern. Cold start acceptable (10-30s from snapshot) for a one-time connect operation.

### Timeout Budget Adjustment
Increased `start_to_close_timeout` from 300s to 600s and added `heartbeat_timeout=60s` for both `ConnectMcpServerWorkflow` and `DiscoverMcpServerWorkflow` to accommodate sandbox creation (up to 180s) + MCP init (270s).

## Project Completion Summary

The security boundary is now fully closed. In cloud mode, untrusted MCP server code never executes inside the agent-runner pod:

| Path | Transport | Where It Runs |
|------|-----------|---------------|
| Agent execution | stdio | Daytona sandbox (T02) |
| Agent execution | HTTP | Remote endpoint (unchanged) |
| Connect/Discover | stdio | Ephemeral Daytona sandbox (T04) |
| Connect/Discover | HTTP | Remote endpoint (unchanged) |
| Local/OSS mode | stdio | Host subprocess (unchanged) |

## Next Steps
1. **PR**: Create pull request for `feat/mcp-server-sandbox-security` branch
2. **E2E validation**: Validate in staging (agent execution + connect workflow + local mode)
3. **Monitor**: Watch Daytona sandbox creation latency and cleanup success rate in production

## Context for Resume
- The `_maybe_create_discovery_sandbox()` helper mirrors `_maybe_create_daytona_mcp_client()` from setup.py — same three-way gating pattern
- Ephemeral sandboxes are created via `SandboxManager.get_or_create_daytona_sandbox(session_id=None, session_client=None)` — the manager already logs "creating ephemeral Daytona sandbox" for this case
- Sandbox is explicitly deleted in the `finally` block via `cleanup_daytona_sandbox()`; the `auto_stop_interval=5` (set by SandboxManager) acts as a safety net if deletion fails
- `_connect_and_discover()` is transport-agnostic: both `DaytonaMCPClient` and `MultiServerMCPClient` expose the same `session()` context manager
- Agent-runner Dockerfile no longer contains Node.js, Go, or uvx — these live in the sandbox image only

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260409.01.mcp-server-sandbox-security/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] All tasks complete — proceed with PR and E2E validation

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260409.01.mcp-server-sandbox-security/next-task.md`
