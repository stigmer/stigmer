# Polyglot MCP Snapshot Workflow and Schedule Registration Fix

**Date**: April 9, 2026

## Summary

Restructured the MCP sandbox snapshot builder from a monolithic Python workflow into a polyglot Temporal workflow where Java (Stigmer Service) owns schedule registration, orchestration, and DB-driven package resolution, while Python (Agent Runner) owns the Daytona snapshot building activity. Also diagnosed and fixed a production bug preventing all Temporal schedule registration.

## Problem Statement

Two issues were identified in the MCP snapshot infrastructure:

### Pain Points

- **Zero schedules in Temporal**: The production Temporal UI showed 0 schedules despite `McpRegistrySyncScheduleRegistrar` being deployed. The existing MCP Registry sync schedule was silently failing on every startup.
- **Monolithic Python workflow**: Both the workflow and activity lived in `build_mcp_snapshot.py` on the agent-runner queue, with no programmatic schedule registration (only a CLI snippet in a docstring) and a static hardcoded package list.
- **No DB-driven package resolution**: The design called for querying the most-used MCP servers from the database, but the Python activity used a static curated list with no access to Stigmer Service's MongoDB.

## Solution

### Schedule Registration Bug Fix

Root cause: `McpRegistrySyncScheduleRegistrar.java` was missing `.setWorkflowId(...)` in `WorkflowOptions.newBuilder()`. The Temporal Java SDK `ScheduleProtoUtil.actionToProto` requires a workflow ID on `ScheduleActionStartWorkflow`. Without it, the call throws `"ID required on workflow action"` — caught by the outer try/catch, so the service started fine but no schedule was ever registered.

Fix: Added `.setWorkflowId(SCHEDULE_ID)` to the `WorkflowOptions` builder.

### Polyglot Workflow Architecture

Following the established `InvokeAgentExecutionWorkflow` pattern (Java workflow + Python activities via memo-based queue routing):

1. **Java workflow** on the `mcp_server_sync` queue orchestrates two activities
2. **Java local activity** (`ResolveSnapshotPackages`) queries the `mcp_server` collection for registry-synced servers, extracts package identifiers from `spec.stdio` configs, and merges with a configurable curated baseline
3. **Python remote activity** (`BuildMcpSnapshot`) on the `agent_execution_runner` queue builds the Daytona image, creates the snapshot, and rotates old snapshots
4. **Schedule registrar** creates the `mcp-snapshot-build` schedule on startup (interval-based, default every 6 hours)

## Implementation Details

### Stigmer Cloud (Java) — New Files

All under `ai.stigmer.domain.agentic.mcpserver.temporal`:

| File | Purpose |
|------|---------|
| `McpSnapshotTemporalConfig.java` | Spring config: runner queue, schedule interval, max packages per runtime, curated baseline lists |
| `McpSnapshotTemporalWorkflowTypes.java` | Workflow and activity type constants for the polyglot boundary |
| `McpSnapshotScheduleRegistrar.java` | Registers `mcp-snapshot-build` schedule on `ApplicationReadyEvent` |
| `workflow/BuildMcpSnapshotWorkflow.java` | Workflow interface (type: `stigmer/mcp-snapshot/build`) |
| `workflow/BuildMcpSnapshotWorkflowImpl.java` | Orchestrates local resolve + remote build |
| `activity/ResolveSnapshotPackagesActivity.java` | Local activity interface |
| `activity/ResolveSnapshotPackagesActivityImpl.java` | Queries MongoDB, extracts packages, merges with baseline |
| `activity/BuildMcpSnapshotActivity.java` | Remote activity stub matching Python `@activity.defn` |
| `model/SnapshotPackages.java` | Resolved package lists record |
| `model/BuildMcpSnapshotInput.java` | Input record with `@JsonProperty` snake_case mapping |
| `model/BuildMcpSnapshotOutput.java` | Output record with `@JsonIgnoreProperties` tolerance |

### Stigmer Cloud (Java) — Modified Files

| File | Change |
|------|--------|
| `McpRegistrySyncScheduleRegistrar.java` | Added `.setWorkflowId(SCHEDULE_ID)` |
| `McpServerSyncTemporalWorkerConfig.java` | Registers both `McpRegistrySyncWorkflow` and `BuildMcpSnapshotWorkflow` |
| `application-temporal.yaml` | Added `temporal.mcp-snapshot` config section |

### Stigmer (Python) — Modified Files

| File | Change |
|------|--------|
| `build_mcp_snapshot.py` | Removed `BuildMcpSnapshotWorkflow` class, `WORKFLOW_NAME`, unused imports |
| `worker.py` | Removed `BuildMcpSnapshotWorkflow` from workflow registration list |

## Benefits

- **Schedules now work**: Both `mcp-registry-sync-daily` and `mcp-snapshot-build` will register on startup
- **DB-driven package resolution**: Snapshot contents automatically adapt as the MCP Registry catalog grows — no manual package list updates
- **Clean separation of concerns**: Java owns the data query and orchestration, Python owns the Daytona SDK operations
- **Follows established patterns**: Same polyglot architecture as `InvokeAgentExecutionWorkflow` (memo-based queue routing, Java workflow + Python activities)
- **Configurable**: Schedule interval, max packages per runtime, curated baseline, and runner queue are all Spring-configurable

## Impact

- **Stigmer Service**: Two new Temporal schedules will appear in the Temporal UI after deployment
- **Agent Runner**: No behavioral change — the `BuildMcpSnapshot` activity runs identically whether invoked by a Python or Java workflow
- **Deployment order matters**: Agent Runner first (removes Python workflow), Stigmer Service second (adds Java workflow + schedules)

## Related Work

- `2026-04-09-183458-fix-temporal-schedule-registration-mcp-registry-sync.md` — Earlier changelog for the schedule registration fix (partial fix, this completes it)
- Project: `20260409.01.mcp-server-sandbox-security` — T01 originally created the snapshot builder as a Python-only workflow

---

**Status**: Production Ready
**Timeline**: 1 session
