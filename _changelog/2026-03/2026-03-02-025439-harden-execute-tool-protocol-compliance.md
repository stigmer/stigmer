# Harden Execute Tool: Explicit Protocol Inheritance

**Date**: March 2, 2026

## Summary

The previous fix for execute-tool stripping (`DeepAgentsBackendAdapter`) relied on duck typing with `@runtime_checkable` protocol checks, which is fragile across Python versions. This change makes the adapter explicitly inherit from `SandboxBackendProtocol`, adds a runtime assertion in `create_deep_agent`, and introduces middleware-level integration tests that verify the execute tool survives the full `FilesystemMiddleware` chain.

## Problem Statement

Despite the adapter implementing all required methods, the execute tool was still being stripped from agents and sub-agents at runtime. The previous fix used structural subtyping (duck typing) for the `isinstance(adapter, SandboxBackendProtocol)` check, which:

- Depends on CPython's `@runtime_checkable` protocol machinery, which changed semantics in Python 3.12 (switched from `hasattr()` to `inspect.getmembers_static()`)
- Had no runtime verification that the adapter actually passes the check before being handed to deepagents
- Had no integration test proving the execute tool survives the middleware filtering chain
- Used a hand-rolled `_verify_protocol_compliance()` function based on `hasattr`, which is not equivalent to what `isinstance()` checks in Python 3.12+

### Pain Points

- Agents and sub-agents silently lost shell execution capability
- The `EXECUTE_CAPABILITY` prompt told agents they could execute, but the tool was stripped before the model saw it
- Skills bundling scripts (e.g. `skill-creator` with `init_skill.py`) were forced to manually recreate script output file-by-file
- No way to confirm in logs whether the protocol check was passing in a running process

## Solution

Three-layer hardening: explicit inheritance, runtime assertion, and middleware integration tests.

## Implementation Details

### 1. Explicit protocol inheritance

`DeepAgentsBackendAdapter` now inherits from `SandboxBackendProtocol` instead of relying on structural subtyping. This makes `isinstance(adapter, SandboxBackendProtocol)` trivially True via MRO, completely bypassing the `@runtime_checkable` structural checking machinery.

The redundant `_verify_protocol_compliance()` function and its module-level call were removed — explicit inheritance makes it unnecessary.

### 2. Runtime assertion in `create_deep_agent`

After creating the adapter, `create_deep_agent` now asserts that `isinstance(deepagents_backend, SandboxBackendProtocol)` is True. If it fails, a `TypeError` is raised with a diagnostic message explaining the consequence ("FilesystemMiddleware will strip the execute tool"). The log message now includes the adapter class name and protocol compliance status.

### 3. Middleware integration tests

Four new tests in `TestMiddlewareIntegration`:

- **`test_execute_tool_preserved_after_wrap_model_call`** — creates a `FilesystemMiddleware(backend=adapter)`, passes a `ModelRequest` with an execute tool, and asserts it survives the sync `wrap_model_call` path
- **`test_execute_tool_preserved_after_awrap_model_call`** — same for the async `awrap_model_call` path
- **`test_execution_system_prompt_appended`** — verifies the execution system prompt is injected when the backend supports execution
- **`test_execute_stripped_without_adapter`** — baseline test proving the middleware *does* strip execute when `backend=None`, confirming the other tests are not vacuously passing

### 4. MRO inheritance test

A new `test_mro_includes_sandbox_backend_protocol` test verifies `SandboxBackendProtocol in DeepAgentsBackendAdapter.__mro__`, which is stronger than `isinstance` — it proves real inheritance, not just structural conformance.

## Files Changed

| File | Change |
|------|--------|
| `backend/libs/python/graphton/src/graphton/core/backends/deepagents_adapter.py` | Inherit from `SandboxBackendProtocol`, remove `_verify_protocol_compliance()` |
| `backend/libs/python/graphton/src/graphton/core/agent.py` | Add runtime isinstance assertion + enhanced diagnostic logging |
| `backend/libs/python/graphton/tests/core/test_deepagents_adapter.py` | Add 5 new tests (1 MRO + 4 middleware integration) |

## Benefits

- **Guaranteed correctness**: `isinstance` is trivially True via MRO — no reliance on CPython Protocol internals
- **Fail-fast at agent creation**: `TypeError` is raised before the middleware ever runs, with a clear diagnostic message
- **Observable in production**: log entry confirms protocol compliance for every agent creation
- **Regression-proof**: middleware integration tests verify the execute tool survives the actual filtering logic, not just that the adapter has the right attributes

---

**Status**: Production Ready
