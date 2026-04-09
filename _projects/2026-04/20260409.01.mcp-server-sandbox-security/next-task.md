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
- **Last Session**: 2026-04-09 — T02 implemented + integration tests passing against live Daytona
- **Active Task**: T01 COMPLETE. T02 COMPLETE. T03 is next.
- **Branch**: `feat/mcp-server-sandbox-security`

## Session Progress (2026-04-09, Session 2)

### T02: Daytona stdio Transport for MCP Server Isolation — COMPLETE
- Created `worker/mcp/daytona_transport.py` — custom MCP transport that mirrors `mcp.client.stdio.stdio_client` but uses Daytona session API (create_session, execute_session_command with run_async=True, get_session_command_logs_async, send_session_command_input)
- Created `worker/mcp/daytona_mcp_client.py` — `DaytonaMCPClient` that routes stdio servers through Daytona sandbox, delegates HTTP servers to standard `MultiServerMCPClient`
- Modified 3 Graphton files to accept optional `client` parameter (mcp_manager.py, middleware.py, agent.py) — Graphton stays Daytona-agnostic
- Wired up `DaytonaMCPClient` creation in `setup.py` for cloud mode when stdio servers are present
- Updated `requirements.txt` to align daytona SDK at 0.151.0 (was 0.129.0, poetry.lock was already 0.151.0)
- Updated `worker/mcp/__init__.py` with new exports

### Architecture Decision: Approach A (Custom MCP Transport)
- Chose Approach A (custom transport) over Approach B (in-sandbox HTTP bridge) because agent-runner communicates with Daytona sandboxes exclusively through the Daytona API — no direct network path to sandbox ports
- Transport mirrors `mcp.client.stdio.stdio_client` exactly: yields `(read_stream, write_stream)` anyio memory streams backed by Daytona session API
- Reuses the entire MCP protocol stack (`ClientSession`) — only the transport layer is replaced

### Test Results
- **23 unit tests** pass: NDJSON framing, shell command building, client routing, mock-based lifecycle
- **5 integration tests** pass against live Daytona: echo roundtrip, real MCP server tool discovery (`@modelcontextprotocol/server-everything`), concurrent sessions, session cleanup
- **1476 existing tests** pass — zero regressions
- `agent-sandbox-full` published to GHCR as `v0.0.74`

### Key Technical Findings
- `mcp==1.25.0` uses `SessionMessage` (wraps `JSONRPCMessage`) — not `JSONRPCMessage` directly
- Serialization: `session_message.message.model_dump_json(by_alias=True, exclude_none=True)` + `"\n"`
- Parsing: `JSONRPCMessage.model_validate_json(line)` → `SessionMessage(message)`
- Daytona sync `Process` class has `get_session_command_logs_async` as an async method (can be awaited)
- `send_session_command_input` is sync — wrapped in `anyio.to_thread.run_sync` for use from async context
- `langchain_mcp_adapters.MultiServerMCPClient` has no transport factory hook for stdio — necessitated the `DaytonaMCPClient` wrapper approach

## Next Steps
1. **T03**: Integrate MCP server process management with Graphton middleware
2. **T04**: Clean up agent-runner Dockerfile — remove bundled MCP runtimes

## Context for Resume
- The `DaytonaMCPClient` is created in `setup.py` only when `sandbox is not None` AND at least one stdio server is configured — local/OSS mode is unchanged
- Graphton's `connect_mcp_client` accepts optional `client` parameter via duck typing (no protocol class, no Daytona import)
- Session naming convention: `mcp-{server_slug}-{short_uuid}` (distinct from workspace sessions `ws-provision-{uuid}`)
- Startup timeout defaults to 60 seconds — logs a warning if MCP server produces no output within that window
- Process crash is detected via EOF on stdout stream — no automatic restart in v1
- The `requirements.txt` daytona version (0.151.0) now matches `poetry.lock`

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
6. [ ] Continue with T03

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-04/20260409.01.mcp-server-sandbox-security/next-task.md`
