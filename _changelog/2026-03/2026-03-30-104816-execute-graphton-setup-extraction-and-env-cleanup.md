# Execute Graphton: Setup Extraction, gRPC Parallelization, and Environment Cleanup

**Date**: March 30, 2026

## Summary

Extracted the setup phase and HITL resume logic from `execute_graphton.py` into focused modules, parallelized independent gRPC fetches to reduce latency, and eliminated the legacy environment resolution paths — establishing `ExecutionContext` as the single source of truth for execution-scoped variables.

## Problem Statement

`execute_graphton.py` had grown to 2,097 lines with `_execute_graphton_impl` spanning ~1,783 lines. The function mixed orchestration, setup, environment resolution, HITL resume logic, streaming, and cleanup in a single monolithic body. Additionally, the environment resolution module maintained a legacy 3-layer fallback path that directly queried `Environment` resources — bypassing the intended `ExecutionContext` contract.

### Pain Points

- A 1,783-line function is unnavigable, untestable, and error-prone during code review
- Three independent gRPC fetches (environment, skills, MCP servers) ran sequentially, adding unnecessary latency
- The legacy environment merge (agent env_spec + environment_refs + runtime_env) was dead code — `ExecutionContext` is always created by the workflow
- The agent runner had a direct dependency on the `Environment` resource via `EnvironmentClient`, violating the aggregate boundary: environment resolution belongs to the workflow, not the activity

## Solution

Decomposed the monolith into focused modules following the existing function + frozen dataclass pattern, parallelized independent gRPC calls, and deleted the legacy environment paths along with the `EnvironmentClient` gRPC client.

## Implementation Details

### Setup Extraction (T04)

- **Created `graphton/setup.py`** (1,348 lines): `SetupResult` frozen dataclass + `perform_setup()` async function containing the entire setup pipeline
- **Extended `graphton/hitl.py`** (263 → 505 lines): `ResumeResult` dataclass + `resolve_resume_input()` function encapsulating HITL resume detection, interrupt matching, and orphan reconciliation
- **Rewrote `execute_graphton.py`** as thin orchestrator (2,097 → 621 lines): crash recovery → setup → HITL resume → stream → post-stream → final status
- **Partial-resource cleanup**: `perform_setup()` cleans up `workspace_backend` and MCP middleware if setup fails partway through

### gRPC Parallelization

- Environment resolution, skill fetch, and MCP server fetch now run concurrently via `asyncio.gather` after the sequential chain resolution step
- MCP fetch is non-fatal (continues with empty config on error)
- Saves ~2 gRPC round-trips of latency per execution

### Environment Cleanup

- **Simplified `environment.py`** (141 → 78 lines): Removed the legacy 3-layer fallback. `ExecutionContext` is the only path — absent `ExecutionContext` raises `ValueError`
- **Deleted `grpc_client/environment_client.py`** (197 lines): The `EnvironmentClient` that directly queried `Environment` resources is gone. Agent runner no longer touches the `Environment` resource
- Removed `EnvironmentResult.used_legacy_merge` field and all related plumbing

## Benefits

- **Navigability**: `_execute_graphton_impl` reads as a 5-step orchestration pipeline instead of a 1,783-line wall
- **Latency**: ~2 fewer sequential gRPC round-trips per execution via parallel fetch
- **Architectural clarity**: Agent runner only reads `ExecutionContext` for env vars — the workflow owns the merge. Clean aggregate boundary.
- **Code deletion**: 197-line `EnvironmentClient` + 63 lines of legacy merge logic deleted. Net reduction of ~1,460 lines from `execute_graphton.py`
- **Testability**: Each extracted module (`setup.py`, `hitl.py`, `environment.py`) can be tested in isolation

## Impact

| Metric | Before | After |
|---|---|---|
| `execute_graphton.py` | 2,097 lines | 621 lines (70% reduction) |
| `_execute_graphton_impl` body | ~1,783 lines | 386 lines (78% reduction) |
| `environment.py` | 141 lines | 78 lines (45% reduction) |
| `EnvironmentClient` | 197 lines | deleted |
| Setup gRPC latency | serial (3 calls) | parallel (~2 RTT saved) |
| Environment paths | 2 (ExecutionContext + legacy 3-layer) | 1 (ExecutionContext only) |

All 1,379 tests pass with zero regressions.

## Related Work

- T01: Quick wins — error dedup, InlinePublisher, recursion limit constant
- T02: LangGraph v2 tool_call_id research confirming ToolCallIdCapture necessity
- T03: HITL bidirectional fallback elimination
- Previous project: StatusBuilder hardening (PR #100)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (T04 + environment cleanup)
