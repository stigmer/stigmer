# Remove Deprecated JIT Discovery Fallback from Python Runner

**Date**: March 27, 2026

## Summary

Removed the deprecated JIT (Just-In-Time) environment resolution fallback from the Python agent-runner's MCP server discovery activity. Now that both Go and Java backends create ExecutionContexts before starting discovery workflows, the rolling-deployment safety net is no longer needed.

## Problem Statement

The previous commit ([Secure Discovery with ExecutionContext](2026-03-27-102916-secure-discovery-with-execution-context.md)) introduced the ExecutionContext pattern for MCP discovery but intentionally kept the old `EnvironmentClient`-based JIT fallback in the Python activity for rolling-deployment safety. With all services now deployed, this dead code added unnecessary complexity and kept an over-privileged code path available.

### Pain Points

- `_resolve_env_vars_jit()` function (~70 lines) was explicitly marked `[DEPRECATED]` but still importable and callable
- `EnvironmentClient` import in the discovery module gave the false impression that the runner still accessed environments directly
- `_PERSONAL_ENV_LABEL` constant and `env_vars` dataclass field existed solely for the deprecated path
- Module and function docstrings referenced the fallback, creating confusion about the actual security model

## Solution

Deleted all JIT-related code and simplified the discovery activity to exclusively use the ExecutionContext path.

## Implementation Details

### Python Activity (`discover_mcp_server.py`)

- Removed `from grpc_client.environment_client import EnvironmentClient`
- Removed `from dataclasses import field` (only needed by the deleted `env_vars` field)
- Removed `_PERSONAL_ENV_LABEL` constant
- Removed `env_vars: dict[str, str]` field from `DiscoverMcpServerInput`
- Removed `_resolve_env_vars_jit()` function entirely
- Simplified `_resolve_env_vars_for_discovery()`: removed `org` and `spec` parameters, returns `{}` when no EC is provided
- Updated module docstring and function docstrings to remove fallback references

### Not Changed (Verified Correct)

- **Go backend** (`discover_capabilities.go`): `environmentClient` is used server-side to create the ExecutionContext — this is the new pattern, not a leftover
- **`grpc_client/environment_client.py`**: Still needed by `execute_graphton.py` and `graphton/environment.py` for agent execution flows
- **Java backend** (`McpServerDiscoverCapabilitiesHandler.java`): Also part of the new server-side pattern

## Benefits

- **Reduced attack surface**: The Python runner no longer has any code path to access arbitrary environments during discovery
- **Simpler code**: ~100 lines removed, making the discovery activity easier to understand and maintain
- **Cleaner imports**: No unnecessary `EnvironmentClient` dependency in the discovery module

## Impact

- **Files changed**: 1 (`discover_mcp_server.py`)
- **Lines removed**: ~100 (net)
- **Risk**: Low — the deleted code was already unreachable when the Go/Java backend provides `execution_context_id`

## Related Work

- [Secure Discovery with ExecutionContext](2026-03-27-102916-secure-discovery-with-execution-context.md) — the parent change that introduced the EC pattern and marked this code as deprecated
- [Fix Discovery Credential Security](2026-03-27-094850-fix-discovery-credential-security.md) — the intermediate JIT fix that moved resolution to Python

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes
