# Next Task: 20260409.01.mcp-server-sandbox-security

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260409.01.mcp-server-sandbox-security

**Description**: Move stdio MCP server execution from the agent-runner pod into the Daytona sandbox for security isolation, and automate snapshot management with pre-installed MCP server packages. Addresses the risk of running untrusted marketplace MCP servers inside the control plane container.
**Goal**: Isolate stdio MCP server execution in Daytona sandboxes (same sandbox used for workspace), automate snapshot lifecycle with popular MCP servers pre-installed, and clean up the agent-runner Dockerfile to no longer bundle MCP runtimes.
**Tech Stack**: Python (agent-runner, Graphton), Daytona SDK (Image, SnapshotService, Process API), Temporal workflows
**Components**: agent-runner (worker/mcp/, worker/activities/, sandbox Dockerfiles, config.py, sandbox_manager.py), Graphton middleware (core/middleware.py, core/mcp_manager.py), agent-runner Dockerfile

## Current State
- **Status**: in-progress
- **Last Session**: 2026-04-09 (Session 3) — T03 validated and closed
- **Active Task**: T01 COMPLETE. T02 COMPLETE. T03 COMPLETE. T04 is next.
- **Branch**: `feat/mcp-server-sandbox-security`

## Session Progress (2026-04-09, Session 3)

### T03: Wire Sandbox MCP Execution into the Agent Pipeline — COMPLETE

**Key finding: T02 already implemented T03's scope.** T02's Approach A (DaytonaMCPClient wrapper) naturally solved the pipeline integration. All 6 success criteria were already met.

- Validated all success criteria against the code (cloud stdio routing, local fallback, HTTP unchanged, teardown, sandbox recovery)
- Extracted `_maybe_create_daytona_mcp_client()` helper from `setup.py` — testable, explicit gating
- Added 10 new unit tests: `TestConnectMcpClientWithInjectedClient` (2), `TestConnectMcpClientDefaultFallback` (1), `TestSetupDaytonaMcpClientGating` (5), `TestMcpCleanupChain` (2)
- Full test suite: **1486 passed**, 21 skipped, 0 failures

### Why T03 Was Subsumed by T02

The T03 plan was written before T02 chose Approach A. It assumed T02 would build a raw transport layer and T03 would wire it into setup.py / Graphton / teardown. Instead, T02's DaytonaMCPClient wrapper pattern solved integration naturally:

- Config transformer does NOT need a sandbox parameter — `DaytonaMCPClient` handles routing
- Graphton already accepts a duck-typed `client` parameter (T02 added it)
- `setup.py` already creates `DaytonaMCPClient` when sandbox + stdio servers present (T02 added it)
- Teardown already cascades through `exit_stack.aclose()` → `daytona_stdio_client` → `delete_session()` (T02 established this)
- Sandbox recovery for MCP is handled by architecture: `perform_setup` runs fresh on every activity invocation

## Next Steps
1. **T04**: Connect/Discover workflow sandboxing + agent-runner Dockerfile cleanup

## Context for Resume
- The `_maybe_create_daytona_mcp_client()` helper (extracted from `setup.py`) encapsulates the gating decision: sandbox + stdio → DaytonaMCPClient, otherwise None
- The `DaytonaMCPClient` is created in `setup.py` only when `sandbox is not None` AND at least one stdio server is configured — local/OSS mode is unchanged
- Graphton's `connect_mcp_client` accepts optional `client` parameter via duck typing (no protocol class, no Daytona import)
- Session naming convention: `mcp-{server_slug}-{short_uuid}` (distinct from workspace sessions `ws-provision-{uuid}`)
- Startup timeout defaults to 60 seconds — logs a warning if MCP server produces no output within that window
- Process crash is detected via EOF on stdout stream — no automatic restart in v1
- The `requirements.txt` daytona version (0.151.0) now matches `poetry.lock`
- **Sandbox recovery for MCP**: Handled naturally — `perform_setup` runs from scratch on every activity invocation (including HITL resumes), so sandbox manager revives the sandbox before MCP servers are started fresh

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
6. [ ] Continue with T04

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260409.01.mcp-server-sandbox-security/next-task.md`
