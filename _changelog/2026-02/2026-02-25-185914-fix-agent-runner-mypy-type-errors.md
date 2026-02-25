# Fix Agent-Runner MyPy Type-Checking Errors

**Date**: February 25, 2026

## Summary

Resolved all 11 mypy type-checking errors that were failing the `lint-and-typecheck-agent-runner` CI job during CLI releases. Every fix is a proper type-safety correction — no suppressions or `# type: ignore` comments — improving the codebase's long-term maintainability and catching real potential bugs.

## Problem Statement

The `lint-and-typecheck-agent-runner` job in the CLI release workflow (`release.cli.yaml`) was failing with 11 mypy errors across 4 Python files in `backend/services/agent-runner/`. This blocked all CLI releases.

### Pain Points

- CI pipeline completely blocked — no CLI releases possible
- Errors spanned multiple files with different root causes (type narrowing, variable shadowing, missing annotations, type redefinitions)
- Some errors cascaded (e.g., a single variable shadowing issue caused 3 downstream errors)

## Solution

Addressed each error with the minimal, semantically correct fix — no workarounds, no type suppressions, no behavior changes.

## Implementation Details

### `worker/config.py` (1 error)

Added an explicit `None` guard for `sandbox_root_dir` at the top of the local-mode branch. This both narrows the type for mypy and provides a clear runtime error message if the invariant (local mode always has a root dir) is ever violated.

### `worker/activities/graphton/status_builder.py` (1 error)

Replaced `dict.pop(key, None) or datetime.utcnow()` with `dict.pop(key, datetime.utcnow())`. Since `datetime` objects are never falsy, the `or` fallback was only ever triggered when `pop` returned `None`. Using `datetime.utcnow()` directly as the default is both type-safe and semantically identical.

### `worker/activities/generate_session_subject.py` (1 error)

Added an `isinstance` check before calling `.strip()` on LangChain's `response.content` (typed as `str | list[str | dict]`). The list-content case is handled gracefully by joining parts, making this production-safe without relying on assertions.

### `worker/activities/execute_graphton.py` (8 errors)

- **Missing annotation**: Added `list[Any]` to `file_uploads` (conditionally-imported `FileUpload` from `daytona` prevents a concrete type)
- **Variable shadowing**: Renamed `p` to `sole_path` in the single-file branch, eliminating 3 cascading type errors
- **Duplicate annotations**: Removed redundant type annotations from `else` branches for `approval_decisions`, `sandbox_config_for_agent`, and `pending_approvals`
- **Dict vs RunnableConfig**: Added `cast(RunnableConfig, config)` for `aget_state()` call, with proper imports of `cast` and `RunnableConfig`

## Benefits

- CI pipeline unblocked — CLI releases can proceed
- Zero `# type: ignore` comments introduced
- Stronger type safety across the agent execution path
- Runtime guard in `config.py` catches misconfiguration early with a clear error message

## Impact

- **CI/CD**: Unblocks the CLI release workflow
- **Agent-Runner service**: All 4 modified files are in the critical agent execution path; fixes improve reliability without changing runtime behavior
- **Developer experience**: Clean mypy output (0 errors across 46 source files) makes it easy to catch regressions

## Related Work

- Part of the ongoing `test/mcp-server-tool-discovery` branch work
- Affects the same `release.cli.yaml` workflow that builds the CLI, agent-runner, and agent-runner image

---

**Status**: Production Ready
