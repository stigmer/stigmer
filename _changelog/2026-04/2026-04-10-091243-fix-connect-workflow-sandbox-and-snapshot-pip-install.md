# Fix Connect Workflow Sandbox Crash and Snapshot pip Install Failure

**Date**: April 10, 2026

## Summary

Two production errors in the Agent Runner:

1. The `stigmer/mcp-server/connect` workflow crashed on every invocation due to a Temporal sandbox import restriction — a second import chain (distinct from the one fixed on April 9) reached `http.client` through the `classify_tool_approvals` activity module.
2. The MCP snapshot build failed because the Daytona SDK's `pip_install()` generates bare `pip install` commands, which Python 3.12+ rejects under PEP 668 ("externally managed environment").

## Problem Statement

### Error 1: Temporal Sandbox Import Restriction (CRITICAL)

When a user clicked "Connect" on an MCP server, the `ConnectMcpServerWorkflow.run()` method performed a lazy import of `classify_tool_approvals`. That module's top-level imports triggered a transitive chain:

```
ConnectMcpServerWorkflow.run()
  -> import classify_tool_approvals
    -> from graphton.core import ModelRegistry
      -> graphton/core/__init__.py: from graphton.core.message_utils import ...
        -> message_utils.py: from langchain_core.messages import ...
          -> langchain_core.utils.utils -> requests -> urllib3 -> http.client
```

Temporal's workflow sandbox blocks `http.client.IncompleteRead.__mro_entries__`, causing a `RestrictedWorkflowAccessError`. The workflow task failed and retried 9 times with exponential backoff before giving up.

**Why the April 9 fix did not prevent this:** That fix addressed a different chain (`worker.mcp.__init__.py` -> `DaytonaMCPClient` -> `langchain_mcp_adapters`) which triggered during worker *startup*. This chain triggers during workflow *runtime* — a completely independent path to the same restricted module.

### Error 2: MCP Snapshot Build Failure (NON-CRITICAL)

The `BuildMcpSnapshot` activity used the Daytona SDK's `Image.pip_install()`, which generates `RUN python -m pip install ...` in the Dockerfile. The base image (`ghcr.io/stigmer/agent-sandbox-full:latest`) uses Python 3.12+, which enforces PEP 668 and refuses system-wide pip installs without `--break-system-packages`.

## Solution

### Fix 1: `workflow.unsafe.imports_passed_through()`

Wrapped the lazy import of `classify_tool_approvals` inside the workflow's `run()` method with Temporal's `workflow.unsafe.imports_passed_through()` context manager. This is the standard Temporal pattern for importing activity modules that have heavy transitive dependencies — the actual activity execution runs outside the sandbox, so bypassing import restrictions here is safe.

### Fix 2: Replace `pip_install()` with `run_commands()` + `--break-system-packages`

Replaced the Daytona SDK's `Image.pip_install()` call with an explicit `Image.run_commands("python -m pip install --break-system-packages ...")`. This is safe because the command runs inside a disposable Docker image layer during snapshot creation.

## Implementation Details

### Files Changed

| File | Change |
|------|--------|
| `worker/activities/discover_mcp_server.py` | Wrap `classify_tool_approvals` import in `workflow.unsafe.imports_passed_through()` |
| `worker/activities/build_mcp_snapshot.py` | Replace `image.pip_install()` with `image.run_commands()` + `--break-system-packages` |
| `tests/integration/test_snapshot_lifecycle.py` | Update `test_pip_install_on_full_image` to mirror the new approach |

### What stayed the same

- No workflow or activity logic changes beyond the import wrapper
- No new dependencies or framework configuration
- No changes to `classify_tool_approvals.py`, `worker.py`, `main.py`, or graphton library
- No changes to the Daytona SDK — the fix works around the SDK's `pip_install()` limitation

### Audit

All `@workflow.defn` classes in the agent-runner were audited. Only `ConnectMcpServerWorkflow` had a lazy import inside `run()`. The legacy `DiscoverMcpServerWorkflow` only references `discover_mcp_server`, which is defined in the same module and pre-loaded at registration — no sandbox risk.

## Benefits

- MCP server "Connect" flow works end-to-end again
- MCP snapshot builds succeed on PEP 668 Python images
- Defense-in-depth: the `imports_passed_through()` wrapper handles any future transitive imports added to `classify_tool_approvals` or its dependencies

## Impact

- **MCP connect flow**: Unblocked — users can connect MCP servers again
- **MCP snapshots**: Unblocked — daily snapshot builds with pre-installed packages succeed
- **Agent execution**: No changes — the agent execution workflow runs through Java, unaffected

---

**Status**: Production Ready
