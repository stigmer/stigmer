# Fix Heartbeat Timeout During Chain Resolution

**Date**: March 2, 2026

## Summary

Fixed a `CancelledError` crash in the `ExecuteGraphton` Temporal activity caused by the chain resolution gRPC calls exceeding Temporal's 30-second heartbeat timeout. This was a regression introduced by the slim-payload refactor (`a4726656`) which changed the activity from receiving the full `AgentExecution` proto to hydrating it via sequential gRPC calls at startup. Additionally, hardened all 8 gRPC clients with per-call deadlines to prevent any single call from blocking indefinitely.

## Problem Statement

The agent-runner was intermittently crashing with `asyncio.exceptions.CancelledError` during the `ExecuteGraphton` activity's setup phase, specifically at `agent_client.get()` during chain resolution.

### Pain Points

- The activity failed silently with a cryptic `CancelledError` traceback, making root cause non-obvious
- The slim-payload refactor introduced 4 sequential gRPC calls (execution, session, agent_instance, agent) during setup, but the heartbeat was only sent after **all** calls completed
- None of the 8 gRPC clients had call-level timeouts, meaning any slow or unresponsive backend could block the asyncio event loop indefinitely
- With `MaximumAttempts: 1` in the Go workflow, a heartbeat timeout was fatal with no automatic retry

## Solution

Two complementary fixes that address both the symptom and the structural vulnerability:

1. **Granular heartbeats during chain resolution**: Replaced the single post-chain heartbeat with per-call heartbeats (`chain_resolution:session`, `chain_resolution:agent_instance`, `chain_resolution:agent`), ensuring the 30-second heartbeat window is never exceeded regardless of individual call latency.

2. **Per-call gRPC deadlines across all clients**: Added a configurable `timeout` parameter (default 10 seconds) to all 8 gRPC client classes. Every stub call now carries a deadline, converting indefinite hangs into fast, actionable `DEADLINE_EXCEEDED` errors.

## Implementation Details

### Heartbeat fix (execute_graphton.py)

The chain resolution block previously had one heartbeat at the end:

```
session = await session_client.get(...)
agent_instance = await agent_instance_client.get(...)
agent = await agent_client.get(...)           # blocks here
heartbeat_during_setup("chain_resolution")    # never reached
```

Now each call is followed by its own heartbeat:

```
session = await session_client.get(...)
heartbeat_during_setup("chain_resolution:session")

agent_instance = await agent_instance_client.get(...)
heartbeat_during_setup("chain_resolution:agent_instance")

agent = await agent_client.get(...)
heartbeat_during_setup("chain_resolution:agent")
```

### gRPC timeout hardening (all 8 clients)

Each client class gained:
- A module-level `_DEFAULT_GRPC_TIMEOUT_SECONDS = 10.0` constant
- A keyword-only `timeout` constructor parameter defaulting to that constant
- `timeout=self._timeout` passed to every gRPC stub call

The 10-second timeout is intentionally shorter than the 30-second heartbeat timeout, ensuring there is always time to send a heartbeat or handle the error gracefully before Temporal cancels the activity.

### Files changed

| File | Change |
|------|--------|
| `worker/activities/execute_graphton.py` | Added per-call heartbeats during chain resolution |
| `grpc_client/agent_client.py` | Added 10s gRPC deadline |
| `grpc_client/session_client.py` | Added 10s gRPC deadline |
| `grpc_client/agent_instance_client.py` | Added 10s gRPC deadline |
| `grpc_client/agent_execution_client.py` | Added 10s gRPC deadline |
| `grpc_client/skill_client.py` | Added 10s gRPC deadline |
| `grpc_client/mcp_server_client.py` | Added 10s gRPC deadline |
| `grpc_client/environment_client.py` | Added 10s gRPC deadline |
| `grpc_client/execution_context_client.py` | Added 10s gRPC deadline |

## Benefits

- Eliminates the heartbeat timeout crash during chain resolution
- Converts indefinite gRPC hangs into bounded, actionable errors across the entire agent-runner
- Timeout is configurable per-client via constructor, allowing callers to tune for their use case
- No changes needed on the Go workflow side; activity-level timeouts remain appropriate

## Impact

- **Agent execution reliability**: The most common setup-phase crash path is eliminated
- **Observability**: `DEADLINE_EXCEEDED` errors with 10s timeout provide clear signal vs. opaque `CancelledError` after 30-62 seconds
- **Future-proofing**: All gRPC clients now have bounded deadlines, preventing this class of failure in any setup phase

## Related Work

- Regression from `a4726656` ("refactor(temporal): slim ExecuteGraphton activity payloads to avoid size limits")
- Temporal activity timeout configuration in `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/execute_graphton.go`

---

**Status**: Production Ready
**Timeline**: ~30 minutes
