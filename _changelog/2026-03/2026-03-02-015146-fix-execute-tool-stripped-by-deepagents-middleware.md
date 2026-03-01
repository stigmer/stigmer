# Fix Execute Tool Stripped by deepagents FilesystemMiddleware

**Date**: March 2, 2026

## Summary

Agents and sub-agents never had access to the `execute` tool at runtime despite graphton correctly provisioning it. The root cause was deepagents' `FilesystemMiddleware` actively filtering out the tool because no `SandboxBackendProtocol`-compliant backend was passed during agent creation. A new `DeepAgentsBackendAdapter` bridges graphton's sandbox backend to the deepagents protocol, preventing the middleware from stripping execution capabilities.

## Problem Statement

When the `skill-creator` sub-agent was tasked with running `init_skill.py` via the `execute` tool, it reported: *"I don't have a shell/terminal execution tool available."* Investigation confirmed that the main agent was also affected — the `execute` tool was provisioned by graphton but silently removed before the model ever saw it.

### Root Cause

The failure chain:

1. **graphton's `create_deep_agent()`** correctly creates an `execute` tool backed by `FilesystemBackend` (local) or `DaytonaBackend` (remote) and passes it in the `tools` list to `deepagents.create_deep_agent()`.

2. **graphton did NOT pass a `backend` parameter** to `deepagents.create_deep_agent()`.

3. **deepagents' `create_deep_agent()`** internally instantiates `FilesystemMiddleware(backend=None)`, which defaults to `StateBackend` — an in-memory backend that does not implement `SandboxBackendProtocol`.

4. **`FilesystemMiddleware.awrap_model_call()`** checks `isinstance(backend, SandboxBackendProtocol)`. Since `StateBackend` fails this check, the middleware **removes every tool named "execute"** from `request.tools` — including graphton's real sandbox-backed tool.

5. This filtering runs on every model call for both the main agent and all sub-agents, making the `execute` tool permanently invisible to the LLM.

### Impact

- All agents and sub-agents lost shell execution capability.
- Skills bundling scripts (e.g. `skill-creator` with `init_skill.py`) became non-functional; sub-agents were forced to manually recreate script output file-by-file.
- The prompt enhancement correctly advertised execute capability (`EXECUTE_CAPABILITY` block), creating a confusing mismatch between what the agent was told it could do and what tools it actually had.

## Solution

Introduce `DeepAgentsBackendAdapter` — a thin adapter that wraps graphton's sandbox backend and implements deepagents' `SandboxBackendProtocol`. Pass this adapter as `backend` to `deepagents.create_deep_agent()`.

This is architecturally minimal: no deepagents source modifications, no middleware disabling, no tool renaming hacks. The adapter delegates all operations to the inner backend, translating only the interface types (e.g. graphton's `ExecutionResult` → deepagents' `ExecuteResponse`).

## Implementation Details

### New file: `graphton/core/backends/deepagents_adapter.py`

- `DeepAgentsBackendAdapter` wraps any graphton backend (FilesystemBackend, DaytonaBackend, etc.)
- Implements all `SandboxBackendProtocol` methods: `execute`, `ls_info`, `read`, `write`, `edit`, `grep_raw`, `glob_info`, `upload_files`, `download_files`, `id`
- `execute()` converts graphton's `ExecutionResult(exit_code, stdout, stderr)` to deepagents' `ExecuteResponse(output, exit_code, truncated)`
- Module-load assertion (`_verify_protocol_compliance`) fails fast if the adapter drifts out of sync with the protocol

### Modified: `graphton/core/agent.py`

- When `sandbox_config` is provided, wraps `sandbox_backend` in `DeepAgentsBackendAdapter`
- Passes the adapter as `backend=deepagents_backend` to `deepagents_create_deep_agent()`
- Without `sandbox_config`, passes `backend=None` (deepagents defaults to StateBackend, which is correct for non-sandbox agents)

### Modified: `graphton/core/backends/__init__.py`

- Exports `DeepAgentsBackendAdapter`

### Updated test: `tests/core/test_recursion_limit.py`

- `test_no_backend_parameter` → `test_backend_none_without_sandbox`: updated to reflect the new contract that `backend` is always passed (as `None` when no sandbox, as adapter when sandbox exists)

### New test: `tests/core/test_deepagents_adapter.py`

- 24 tests covering:
  - **Protocol compliance**: `isinstance(adapter, SandboxBackendProtocol)`, `_supports_execution()` returns `True`
  - **Execute**: stdout/stderr capture, exit codes, `ExecuteResponse` type
  - **File operations**: read, write, edit, ls_info, grep, glob
  - **Upload/download**: roundtrip, error handling
  - **ID delegation**: stable ID, inner backend delegation

## Files Changed

| File | Change |
|------|--------|
| `backend/libs/python/graphton/src/graphton/core/backends/deepagents_adapter.py` | **New** — adapter implementing SandboxBackendProtocol |
| `backend/libs/python/graphton/src/graphton/core/backends/__init__.py` | Export DeepAgentsBackendAdapter |
| `backend/libs/python/graphton/src/graphton/core/agent.py` | Create adapter, pass as `backend` to deepagents |
| `backend/libs/python/graphton/tests/core/test_deepagents_adapter.py` | **New** — 24 adapter tests |
| `backend/libs/python/graphton/tests/core/test_recursion_limit.py` | Update test to reflect new backend passing contract |
