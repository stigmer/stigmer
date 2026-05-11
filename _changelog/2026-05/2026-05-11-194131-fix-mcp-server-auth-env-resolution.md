# Fix MCP Server Authentication: Environment Variable Resolution in Both Runners

**Date**: May 11, 2026

## Summary

Fixed MCP server authentication failures caused by unresolved environment variable placeholders in both the Python agent-runner and TypeScript cursor-runner. The agent-runner silently sent literal `${VAR_NAME}` strings as credentials due to lenient placeholder resolution; the cursor-runner had no environment resolution pipeline at all. Both runners now use strict resolution that fails fast with a clear error when a required variable is missing.

## Problem Statement

When users connected MCP servers that required API key authentication (e.g., Planton with `Authorization: Bearer ${PLANTON_API_KEY}`), the connection failed with a cryptic "Authentication failed: The API key is missing, invalid, or expired" error from the remote server — even though the API key was correctly stored in the user's personal environment.

### Pain Points

- **Agent-runner (Python)**: The `PlaceholderResolver` for HTTP headers used `strict=False` (lenient mode), which silently preserved literal `${VAR_NAME}` strings when a variable was missing. The MCP server received `Bearer ${PLANTON_API_KEY}` as the actual token value, causing authentication to fail with no indication of the root cause.
- **Cursor-runner (TypeScript)**: Had *no* environment variable resolution pipeline whatsoever — it did not fetch `ExecutionContext`, did not resolve placeholders in HTTP headers, and did not filter environment variables to MCP-declared keys. All `${VAR}` references were sent verbatim.
- **Diagnostic gap**: Neither runner logged environment variable keys at resolution boundaries, making it impossible to trace where variables were dropped without adding temporary debug code.

## Solution

A two-pronged fix targeting both runners, with strict-by-default resolution and comprehensive diagnostic logging.

## Implementation Details

### Agent-Runner (Python)

- **Switched HTTP header/query-param resolution to strict mode**: Replaced the module-level `_resolver = PlaceholderResolver(strict=False)` with `_strict_resolver` for all placeholder resolution in `_transform_http_config`. A missing variable now raises `PlaceholderResolutionError` instead of silently producing a broken credential.
- **Added diagnostic logging**: `_filter_env_to_declared_keys` now logs the count and sorted key names of both the incoming `env_vars` and the `spec.env` declarations. `_transform_http_config` logs resolved header keys after successful resolution. `resolve_environment` logs the merged environment variable keys.
- **Updated tests**: Replaced lenient-mode tests (`test_http_unresolved_placeholder_warning`) with strict-mode tests (`test_http_missing_header_placeholder_raises`, `test_http_partial_header_vars_raises`) that verify `PlaceholderResolutionError` is raised. Updated fixtures to set `spec.env` explicitly for correct filtering behavior.

### Cursor-Runner (TypeScript)

- **New `placeholder-resolver.ts`**: Ported strict placeholder resolution to TypeScript with `resolvePlaceholders`, `resolveHeaders`, `filterEnvToDeclaredKeys`, and a `PlaceholderResolutionError` class. Matches the agent-runner's behavior with fail-fast semantics.
- **New `env-resolver.ts`**: Fetches the `ExecutionContext` from the Stigmer backend and extracts decrypted environment variables, mirroring the agent-runner's `resolve_environment` activity.
- **Updated `stigmer-client.ts`**: Added `getExecutionContextByExecutionId` method using the `ExecutionContextQueryController` RPC to support environment resolution.
- **Updated `mcp-resolver.ts`**: Integrated environment filtering and placeholder resolution — HTTP server headers are resolved via `resolveHeaders`, stdio server args via `resolvePlaceholders`, and environment variables are filtered to MCP-declared keys via `filterEnvToDeclaredKeys`.
- **Updated `execute-cursor.ts`**: Added "Phase 2b: Resolve execution environment" between session loading and MCP resolution to fetch and inject environment variables.
- **Comprehensive tests**: Added `placeholder-resolver.test.ts` covering strict resolution, header resolution, and environment filtering. Extended `mcp-resolver.test.ts` with tests for HTTP headers with resolved placeholders and stdio servers with injected environment variables.

### Design Decision: Connect vs Session Asymmetry

The Connect/Discover flow (interactive MCP server setup) passes *unfiltered* environment variables to MCP servers, while Session execution passes *filtered* variables (only those declared in `spec.env`). This asymmetry was identified during analysis and deliberately preserved — Connect needs broad access for discovery, while Session execution benefits from the principle of least privilege.

## Benefits

- **Fail-fast errors**: Missing credentials now produce a clear `PlaceholderResolutionError` with the variable name and context, instead of a cryptic downstream auth failure.
- **Cursor-runner parity**: The cursor-runner now has full environment resolution, achieving feature parity with the agent-runner.
- **Diagnostic visibility**: Operators can trace environment variable flow through the resolution chain without adding temporary debug code.
- **All 50 Python tests pass** and **all 399 TypeScript tests pass** with the new strict behavior.

## Impact

- All users connecting MCP servers that require authenticated HTTP headers (API keys, bearer tokens, etc.) through session execution.
- Both the Python agent-runner (Daytona sandbox) and TypeScript cursor-runner (local/cloud) are fixed.
- No breaking changes to the public API — the fix is internal to the runner execution pipeline.

## Related Work

- `2026-05-10-171243-fix-mcp-connect-classify-tool-batching.md` — MCP Connect flow improvements
- `2026-05-10-165430-session-composer-follow-up-mcp-skill-hydration.md` — MCP session integration

---

**Status**: ✅ Production Ready
**Timeline**: ~4 hours (investigation + dual-runner implementation + tests)
