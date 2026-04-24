# AgentRunner Proto Resource Definition

**Date**: April 20, 2026

## Summary

Introduced AgentRunner as a first-class API resource in the `agentic` bounded context. The proto definition establishes the contract for runner registration, heartbeat-based liveness, session binding, and execution observability — the foundation for per-execution cloud runners and user-managed persistent runners.

## Problem Statement

Agent execution infrastructure was invisible to the domain model. Runners existed as unnamed Temporal workers polling a shared queue, with no API identity, no lifecycle tracking, and no way for users to manage them. This blocked three product capabilities:

### Pain Points

- No way for users to register and manage their own runners (local machine, GPU server)
- Session composer had no "where does this run?" concept — only implicit cloud execution
- No observability into which runner handled a given execution
- Shared task queue meant no isolation between runners
- Runner identity was ephemeral — restarts created a new anonymous worker

## Solution

Define AgentRunner following the Kubernetes Node pattern: thin spec (the user declares a name and description), rich status (the runner self-reports everything via heartbeat). Both ephemeral cloud runners and user-created persistent runners are the same resource type, differentiated by a metadata label.

## Implementation Details

### New Proto Package: `apis/ai/stigmer/agentic/agentrunner/v1/`

6 new proto files establishing the complete resource contract:

- **`api.proto`**: `AgentRunner` resource with `AgentRunnerStatus` (phase, task_queue, heartbeat timestamps, current_executions, sandbox_id, connection_info) and `AgentRunnerConnectionInfo` (hostname, os, arch, runner_version)
- **`spec.proto`**: `AgentRunnerSpec` with a single `description` field — deliberately thin
- **`enum.proto`**: `AgentRunnerPhase` enum with documented state transitions (PENDING → READY ↔ BUSY → STOPPED, any → FAILED)
- **`io.proto`**: `AgentRunnerId`, `AgentRunnerHeartbeatInput`, `ListAgentRunnersRequest`, `AgentRunnerList`
- **`command.proto`**: `AgentRunnerCommandController` with `apply`, `create`, `update`, `delete`, `heartbeat` RPCs
- **`query.proto`**: `AgentRunnerQueryController` with `get`, `getByReference`, `list` RPCs

### Modified Existing Protos

- **`ApiResourceKind`**: `agent_runner = 46` with id_prefix `arn`, org-scoped authorization, owner+viewer roles
- **`IamPermission`**: `can_create_agent_runner = 25`
- **`SessionSpec`**: `agent_runner_id` (field 9) — binds a session to a specific runner
- **`AgentExecutionStatus`**: `agent_runner_id` (field 19) — records which runner handled the execution

### Codegen

Full `make codegen` run regenerated stubs across all 4 language targets (Go, Java, Python, TypeScript) plus SDK clients, MCP server, documentation, and schemas. `buf lint` and `buf breaking` both pass — all changes are purely additive.

## Benefits

- **Runner identity persistence**: CLI stores runner ID locally; `apply` reactivates the same resource across restarts (same queue, same identity)
- **Session composer integration**: Users will pick a runner in the session composer — "Cloud", "My Laptop", "Team GPU Server"
- **Per-runner queues**: `agent-runner:{runner-id}` gives clean isolation between runners
- **Execution observability**: Every execution records which runner handled it
- **Unified resource model**: Both ephemeral and persistent runners are the same resource type — one code path for dispatch

## Impact

- **Proto contract**: Defines the API surface that Java (stigmer-service), Go (stigmer-server), Python (agent-runner), and client apps (CLI, web, desktop) will implement against
- **All 4 language stubs generated**: Go, Java, Python, TypeScript — ready for implementation
- **SDK updated**: Go, Java, Python, TypeScript SDKs now include AgentRunner client and type definitions
- **Backward compatible**: All changes are additive — no existing fields modified or removed

## Related Work

- Phase 0: Side-Channel Proxy (code complete, pending deploy)
- Phase 2: Daytona operational gates (validated, 3/3 pass)
- Next: Phase 1 Java/Go implementation of AgentRunner aggregate, handlers, and dispatch integration

---

**Status**: ✅ Production Ready (proto contract complete, implementation next)
**Timeline**: Design brainstorm + implementation in one session
