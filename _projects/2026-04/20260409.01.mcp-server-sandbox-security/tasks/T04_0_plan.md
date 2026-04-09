# Task T04: Connect/Discover Sandboxing and Agent-Runner Cleanup

**Created**: 2026-04-09
**Status**: PENDING
**Estimated Effort**: 1 session
**Depends On**: T03 (pipeline integration must be working)

## Objective

Complete the security migration by sandboxing the Connect/Discover workflow (which also runs stdio MCP servers for tool discovery), removing MCP runtimes from the agent-runner Dockerfile, and updating documentation.

## Background

There are two paths that currently run stdio MCP servers locally in the agent-runner:

1. **Agent execution** (addressed in T02-T03): MCP servers run during agent work. Now routed through sandbox.
2. **Connect/Discover workflow**: `ConnectMcpServerWorkflow` runs `discover_mcp_server` activity which launches stdio MCP servers locally just for tool discovery + `classify_tool_approvals`. This is a short-lived operation (discover tools, classify, done) but still runs untrusted code in the agent-runner pod.

After both paths use the sandbox, the agent-runner no longer needs Node.js, Go, or uvx installed.

## Scope

### 1. Connect/Discover Workflow Sandboxing

Update `worker/activities/discover_mcp_server.py`:
- For stdio MCP servers in cloud mode:
  - Create an ephemeral Daytona sandbox (or reuse a warm sandbox pool if available)
  - Start the MCP server inside the sandbox using the Daytona stdio relay
  - Run tool discovery (`session.list_tools()`) and resource template listing via the relay
  - Tear down the sandbox after discovery
- For HTTP MCP servers: no change (already remote)
- For local mode: no change (keep local subprocess)
- The connect workflow already has `execution_context_id` and `invoker_identity_account_id` for auth -- pass these through

Considerations:
- Discovery is short-lived (typically < 30 seconds). Creating a full sandbox for this may add significant latency.
- Alternative: use the first-agent-execution backfill path exclusively (skip sandbox for discovery, rely on `_needs_backfill()` to discover on first use when the sandbox is already warm). This avoids the cold start cost for connect.
- Decision: evaluate both approaches during execution.

### 2. Agent-Runner Dockerfile Cleanup

Remove MCP runtimes from `backend/services/agent-runner/Dockerfile`:
- Remove Node.js/npx installation (lines 93-102)
- Remove Go toolchain copy (line 105)
- Remove uv/uvx copy (line 109)
- Remove the runtime verification step (lines 112-113)
- Update comments to explain that MCP runtimes now live in the sandbox image
- Keep the HEALTHCHECK and other non-MCP dependencies unchanged

This makes the agent-runner a pure Python orchestrator -- it connects to MCP servers via the sandbox but never runs them locally.

### 3. Documentation Updates

Update documentation to reflect the new architecture:
- `docs/sandbox/execution-modes.md` -- add note about MCP server sandboxing in cloud mode
- `docs/sandbox/daytona-setup.md` -- update to reflect automated snapshot creation (no more manual steps)
- Add inline code comments explaining the security boundary

### 4. End-to-End Validation

Validate the complete flow:
- [ ] Agent execution with stdio MCP servers in cloud mode (runs in sandbox)
- [ ] Agent execution with HTTP MCP servers (unchanged, still remote)
- [ ] Agent execution in local mode (stdio runs as local subprocess, no regression)
- [ ] Connect/Discover workflow for stdio servers
- [ ] Snapshot creation workflow produces valid snapshots
- [ ] Sandbox creation uses DB-driven snapshot name
- [ ] MCP server process cleanup on agent teardown
- [ ] Sandbox recovery scenario (sandbox auto-stopped during HITL wait, then revived)

## Success Criteria

- [ ] Connect/Discover workflow uses sandbox for stdio MCP servers (or relies on backfill)
- [ ] Agent-runner Dockerfile no longer contains Node.js, Go, or uvx
- [ ] Agent-runner container image is smaller and has reduced attack surface
- [ ] All existing functionality works (local mode, HTTP MCP, agent execution)
- [ ] Documentation updated

## Files to Modify

| Action | File |
|--------|------|
| Modify | `backend/services/agent-runner/worker/activities/discover_mcp_server.py` |
| Modify | `backend/services/agent-runner/Dockerfile` |
| Modify | `backend/services/agent-runner/docs/sandbox/execution-modes.md` |
| Modify | `backend/services/agent-runner/docs/sandbox/daytona-setup.md` |

## Notes

- The connect workflow runs on the same `agent_execution_runner` task queue as agent execution
- `discover_mcp_server.py` has a `SESSION_INIT_TIMEOUT_SECONDS = 270` -- this timeout should also apply to sandbox-based discovery
- After this task, the security boundary is complete: untrusted MCP server code never executes inside the agent-runner pod in cloud mode
