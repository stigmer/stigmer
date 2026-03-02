# Fix Missing agent_id on Agent Execution

**Date**: March 2, 2026

## Summary

Fixed a regression where the CLI cleared `agent_id` from agent execution requests when creating workspace sessions, causing session subject generation to fail with `ValueError: agent_id cannot be empty`. The fix ensures `agent_id` is always sent alongside `session_id` and adds defensive chain-based resolution in the agent-runner.

## Problem Statement

After the flow changed from "create execution first, then session" to "create session first, then execution" (for workspace support), the CLI was explicitly clearing `agent_id` from the execution request when a session was pre-created. This left the persisted execution record with an empty `agent_id`.

### Pain Points

- `generate_session_subject.py` failed on every workspace-based run because it read `agent_id` directly from the execution spec
- The `agent_id` field on executions was treated as mutually exclusive with `session_id` in the CLI, despite the server accepting both
- No fallback resolution existed in the subject generation activity, unlike `execute_graphton.py` which resolves through the session chain

## Solution

Two-layer fix: (1) CLI sends both `session_id` and `agent_id` when both are available, and (2) the agent-runner resolves `agent_id` from the session chain as a defensive fallback.

## Implementation Details

**CLI (`run_create.go`)**: Changed the exclusive OR conditional (`if/else`) to two independent conditionals, allowing both `session_id` and `agent_id` to be set on the spec simultaneously.

**CLI (`run_agent_exec.go`)**: Removed the explicit `execInput.AgentID = ""` that cleared the agent ID after creating a workspace session.

**Agent-runner (`generate_session_subject.py`)**: Added `_resolve_agent_id_from_session()` helper that resolves `agent_id` through the session chain (`session -> agent_instance -> agent`), mirroring the pattern already used in `execute_graphton.py`. This makes subject generation resilient for all callers, including follow-up TUI executions and API/workflow triggers that may only provide `session_id`.

**Proto (`spec.proto`)**: Updated field comments on `session_id` and `agent_id` to clarify the "at least one required, both may be provided" semantics.

## Benefits

- Session subjects now generate correctly for workspace-based runs
- The execution record carries both `session_id` and `agent_id` as useful metadata, reducing the need for downstream chain resolution
- Subject generation is resilient to any caller that provides only `session_id`

## Impact

- **CLI users**: `stigmer run agent --workspace` and `stigmer draft` commands now produce sessions with auto-generated titles
- **Server pipeline**: No changes needed; `ValidateSessionOrAgent` already accepted both fields
- **Agent-runner**: Subject generation no longer crashes; falls back gracefully when `agent_id` is absent

---

**Status**: Production Ready
