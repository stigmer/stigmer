# T03: Validate Sandbox MCP Pipeline Integration

**Date**: April 9, 2026

## Summary

Validated that T02's Approach A (DaytonaMCPClient wrapper) naturally completed the T03 pipeline integration scope. Extracted a testable helper function from `setup.py`, added 10 unit tests covering the integration seams between setup.py, Graphton middleware, and the Daytona transport, and confirmed zero regressions across the full 1486-test suite.

## Problem Statement

T03 was planned to wire the Daytona stdio relay (T02) into the agent execution pipeline — config transformer, Graphton middleware, setup.py, and teardown. However, T02's architecture choice (Approach A: custom transport with DaytonaMCPClient wrapper) solved the pipeline integration as a side effect of building the transport.

### Pain Points

- T03's original plan called for changes to 6 files (`config_transformer.py`, `setup.py`, `execute_graphton.py`, `middleware.py`, `mcp_manager.py`, `agent.py`) that were no longer needed
- The inline gating logic in `setup.py` (20 lines deep in a 1560-line function) was untestable
- No unit tests validated the integration seams between the agent-runner pipeline and Graphton's MCP client injection

## Solution

Rather than adding unnecessary code changes, we validated the existing implementation against all 6 T03 success criteria, extracted the one piece of inline logic worth isolating, and closed the test coverage gaps at the integration seams.

## Implementation Details

### Helper Extraction: `_maybe_create_daytona_mcp_client()`

Extracted the DaytonaMCPClient creation logic from `setup.py`'s `_perform_setup_core` into a standalone function that encapsulates the three-way gating decision:

1. No sandbox (local/OSS mode) -> `None`
2. Sandbox present, all HTTP servers -> `None`
3. Sandbox present, at least one stdio server -> `DaytonaMCPClient`

### Integration Seam Tests (10 new tests)

| Test Class | Tests | What It Validates |
|-----------|-------|-------------------|
| `TestConnectMcpClientWithInjectedClient` | 2 | Graphton's `connect_mcp_client` uses injected client, never instantiates `MultiServerMCPClient` |
| `TestConnectMcpClientDefaultFallback` | 1 | Without injected client, `MultiServerMCPClient` is created normally |
| `TestSetupDaytonaMcpClientGating` | 5 | All gating scenarios: sandbox+stdio, sandbox+HTTP-only, no sandbox, empty configs, mixed |
| `TestMcpCleanupChain` | 2 | `AsyncExitStack.aclose()` cascades through session cleanup to Daytona `delete_session()` |

### Success Criteria Validation

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Cloud stdio in sandbox | Met | `setup.py` creates `DaytonaMCPClient` when `sandbox is not None` |
| Agent invokes MCP tools via relay | Met | Integration tests (T02) prove real tool invocation |
| Local mode unchanged | Met | `DaytonaMCPClient` only created when sandbox present |
| HTTP servers unchanged | Met | `DaytonaMCPClient` delegates HTTP to `MultiServerMCPClient` |
| Teardown cleans up sessions | Met | `exit_stack.aclose()` -> `daytona_stdio_client` -> `delete_session()` |
| Sandbox recovery restarts MCP | Met | `perform_setup` runs fresh on every activity invocation |

## Benefits

- **Zero unnecessary code changes**: Config transformer, Graphton middleware, and execute_graphton.py remain untouched
- **Testable gating logic**: The extracted helper makes the DaytonaMCPClient creation decision explicit and independently testable
- **Complete integration test coverage**: The 10 new tests validate every seam between setup.py, Graphton, and the Daytona transport
- **Full regression confidence**: 1486 tests pass with zero failures

## Impact

- **Agent Runner**: `setup.py` is slightly cleaner (extracted helper vs inline block)
- **Test Suite**: 10 new tests (1476 -> 1486 total)
- **Project Progress**: T03 closed; T04 (Dockerfile cleanup + Connect/Discover sandboxing) is next

## Related Work

- Previous: [T02 Daytona stdio relay](2026-04-09-174800-daytona-stdio-relay-mcp-server-isolation.md)
- Next: T04 — Connect/Discover workflow sandboxing and agent-runner Dockerfile cleanup

---

**Status**: Production Ready
**Timeline**: 1 session (validation-focused)
