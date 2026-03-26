# Fix Execute Tool Backend Contract Mismatch

**Date**: March 26, 2026

## Summary

Fixed a crash where the agent's `execute` platform tool failed with `'ExecuteResponse' object has no attribute 'stdout'` when running against Daytona cloud sandboxes. The root cause was a broken backend contract: graphton's tool wrapper assumed all backends return an `ExecutionResult` with `.stdout`/`.stderr`, but the Daytona sandbox backend (via deepagents' `DaytonaBackend`) returns an `ExecuteResponse` with `.output` instead. Introduced a shared canonical `ExecutionResult` type and translation layer at the adapter boundary.

## Problem Statement

When agents executed shell commands (`ls -la`, `git status`, etc.) against Daytona cloud sandboxes, the `execute` platform tool crashed immediately with an `AttributeError`. The error was caught by the generic exception handler and surfaced to the agent as an unhelpful recovery suggestion, making the sandbox completely unusable for any shell command.

### Pain Points

- Every `execute` tool call against a Daytona sandbox failed — agents could not run any shell commands in cloud mode
- The error message (`'ExecuteResponse' object has no attribute 'stdout'`) was surfaced to the LLM as a generic recovery suggestion, providing no diagnostic value
- Local filesystem mode worked fine, making this a cloud-only regression that was invisible during local development
- The backend parameter in `_create_execute_tool` was typed as `Any`, so the type mismatch was invisible to static analysis

### Root Cause

Two different backend implementations returned incompatible types from `execute()`:

| Backend | Return Type | Fields |
| --- | --- | --- |
| `FilesystemBackend` (graphton) | `ExecutionResult` | `.stdout`, `.stderr`, `.exit_code` |
| `DaytonaBackend` (deepagents_cli) | `ExecuteResponse` | `.output`, `.exit_code`, `.truncated` |

`WorkspaceNormalizingBackend` (the Daytona wrapper in graphton) passed the inner backend's response through without translation. The tool wrapper in `_create_execute_tool` unconditionally read `.stdout` and `.stderr`, crashing on `ExecuteResponse`.

## Solution

Established a uniform backend execution result contract in graphton with translation at the adapter boundary, plus a defensive guard at the consumer site.

## Implementation Details

### 1. Shared `ExecutionResult` type (`types.py` — new file)

Promoted `ExecutionResult` from a local dataclass in `filesystem.py` to a shared module at `graphton/core/backends/types.py`. This is graphton's canonical execution result type. Also provides `to_execution_result()`, a normalisation function that translates any backend response into `ExecutionResult` by checking for `.stdout` first, falling back to `.output`.

### 2. `WorkspaceNormalizingBackend.execute()` translation (`daytona.py`)

The primary fix. `execute()` now calls `to_execution_result(raw)` on the inner backend's response instead of passing it through. This translates `DaytonaBackend`'s `ExecuteResponse` into `ExecutionResult` at the natural adapter boundary.

### 3. Defensive guard in `_create_execute_tool` (`tool_wrappers.py`)

Belt-and-suspenders: the tool wrapper now uses `getattr` with a type-safe `.output` fallback instead of directly accessing `.stdout`/`.stderr`, protecting against any future backend that might bypass the adapter layer.

### 4. Backward-compatible re-export (`filesystem.py`, `__init__.py`)

`filesystem.py` now imports `ExecutionResult` from `types.py` and re-exports it. The package `__init__.py` exports both `ExecutionResult` and `to_execution_result`.

## Benefits

- Daytona cloud sandbox agents can execute shell commands again
- Graphton now has a single canonical execution result type that all backends must conform to
- The translation logic lives in one place (`to_execution_result`) rather than being duplicated across consumers
- The defensive guard in the tool wrapper prevents hard crashes even if a new backend is introduced without proper adaptation

## Impact

- **Agent executions on Daytona sandboxes**: Fixed — all `execute` tool calls now work correctly
- **Local filesystem mode**: Unaffected — `FilesystemBackend` already returned `ExecutionResult`
- **Test coverage**: 15 new tests (7 for `to_execution_result`, 4 for `WorkspaceNormalizingBackend` translation, 2 for tool wrapper with output-only backends, 2 for edge cases)

## Related Work

- [Fix Daytona Sandbox stdout/stderr Capture](2026-03-26-133354-fix-daytona-sandbox-stdout-stderr-capture.md) — Fixed the agent-runner's `DaytonaWorkspaceBackend` (workspace provisioning). This changelog fixes the separate graphton-level `execute` platform tool that agents use directly.

---

**Status**: ✅ Production Ready
