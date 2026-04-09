# Task T01: Sandbox Image Enhancement and Automated Snapshot Pipeline

**Created**: 2026-04-09
**Status**: PENDING REVIEW
**Estimated Effort**: 1 session

## Objective

Prepare the sandbox infrastructure for MCP server execution: enhance the sandbox Docker image with all MCP runtimes (Go, uvx), build a Temporal scheduled workflow that auto-creates Daytona snapshots with popular MCP server packages pre-installed, make sandbox creation use a DB-driven snapshot name, and implement safe snapshot rotation.

## Background

Today, stdio MCP servers (`npx`, `uvx`, `go run`) run as subprocesses inside the agent-runner pod. To move them into the Daytona sandbox, the sandbox image must have the same runtimes the agent-runner currently bundles. Additionally, to avoid cold-start latency (downloading npm/pip packages on first use), we automate snapshot creation with popular MCP servers pre-installed.

## Scope

### 1. Sandbox Dockerfile Enhancement

Update `backend/services/agent-runner/sandbox/Dockerfile.sandbox.basic` to add:
- **Go toolchain**: `COPY --from=golang:1.25 /usr/local/go /usr/local/go` (same pattern as agent-runner Dockerfile line 105)
- **uv/uvx**: `COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/` (same pattern as agent-runner Dockerfile line 109)
- Verify all runtimes work under the `sandbox` non-root user (UID 1000)

Key files:
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.basic`
- `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` (update if needed)
- Reference: `backend/services/agent-runner/Dockerfile` lines 86-113

### 2. Snapshot Builder Temporal Workflow

Create a new Temporal activity + workflow that programmatically builds Daytona snapshots:

- **Activity** (`worker/activities/build_mcp_snapshot.py`):
  - Query MongoDB for the most-used MCP servers (configurable time window and limit)
  - Separate by runtime: npm (npx-based), pip (uvx-based), Go modules
  - Build a `daytona.Image` declaratively:
    - `Image.base("ghcr.io/stigmer/agent-sandbox-basic:latest")`
    - `.run_commands("npm install -g @pkg1", ...)` for npm MCP servers
    - `.pip_install("pkg1", ...)` for Python MCP servers
    - `.run_commands("go install github.com/org/pkg@latest", ...)` for Go servers
  - Create snapshot: `daytona.snapshot.create(CreateSnapshotParams(name=f"stigmer-mcp-{timestamp}", image=image))`
  - Store the new snapshot name in MongoDB (platform config collection)
  - Clean up old snapshots: keep last 3, delete older via `daytona.snapshot.delete()`

- **Workflow**: Orchestrate the activity, register in `worker/worker.py`
- **Schedule**: Configurable interval (e.g., every 6 hours)
- **Guard**: Skip if `DAYTONA_API_KEY` is not configured

Key Daytona SDK APIs:
- `Image.base()`, `.run_commands()`, `.pip_install()` (generates Dockerfile under the hood)
- `daytona.snapshot.create(CreateSnapshotParams(name=..., image=...))` -- polls until ACTIVE/ERROR
- `daytona.snapshot.list()`, `daytona.snapshot.delete(snapshot)`

### 3. Dynamic Snapshot Configuration

Update sandbox creation to read the active snapshot name from DB:

- In `worker/config.py` `get_sandbox_config()`: try DB first, fall back to `DAYTONA_DEV_TOOLS_SNAPSHOT_ID` env var, fall back to no snapshot
- Cache the DB value with a TTL (e.g., 5 minutes) to avoid per-creation DB queries
- Log which snapshot is being used

### 4. Snapshot Lifecycle Management

In the snapshot builder activity, after creating a new snapshot:
- List all snapshots with the `stigmer-mcp-` prefix
- Sort by creation time, keep the most recent 3
- Delete older snapshots (best-effort, log warnings on failure)
- Deleting old snapshots is safe because running sandboxes are independent after creation

## Success Criteria

- [ ] `Dockerfile.sandbox.basic` includes Node.js, Python/pip, Go, and uv/uvx
- [ ] Temporal workflow creates snapshots with top-N MCP servers pre-installed
- [ ] Sandbox creation reads active snapshot from DB with env var fallback
- [ ] Old snapshots cleaned up (keep last 3)
- [ ] No manual snapshot management required

## Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `backend/services/agent-runner/sandbox/Dockerfile.sandbox.basic` |
| Modify | `backend/services/agent-runner/sandbox/Dockerfile.sandbox.full` |
| Create | `backend/services/agent-runner/worker/activities/build_mcp_snapshot.py` |
| Modify | `backend/services/agent-runner/worker/worker.py` |
| Modify | `backend/services/agent-runner/worker/config.py` |
| Modify | `backend/services/agent-runner/worker/sandbox_manager.py` |

## Notes

- The `Image` class generates a Dockerfile under the hood -- `run_commands()` adds `RUN` lines
- Snapshot names must be unique -- use timestamp suffix
- `on_logs` callback provides build log observability
- This task is foundational -- T02-T04 depend on the sandbox having the right runtimes and snapshots

## Review Process

1. Review this plan
2. Provide feedback (I'll create T01_1_review.md)
3. I'll revise and create T01_2_revised_plan.md
4. After approval, execution tracked in T01_3_execution.md
