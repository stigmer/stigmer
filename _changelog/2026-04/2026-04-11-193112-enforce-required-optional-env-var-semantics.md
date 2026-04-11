# Enforce Required/Optional EnvVarDeclaration Semantics Across All Layers

**Date**: April 11, 2026

## Summary

The `EnvVarDeclaration.optional` flag — introduced in T02 and wired into proto in T05 — was only honored by a single consumer (Java's `McpEnvironmentValidator`). This change enforces the required/optional distinction consistently across Go backend, Java backend, and React frontend so that optional env vars never block MCP server connect, agent execution, or session send.

## Problem Statement

After T05 introduced `EnvVarDeclaration` with an `optional` boolean field, the proto contract was clear: `optional=false` (default) means the execution pipeline should reject a run if the variable is missing; `optional=true` means the MCP server degrades gracefully without it. In practice, every consumer ignored this field and treated all declared keys as required.

### Pain Points

- **MCP servers with debug/optional vars (e.g. `FASTMCP_LOG_LEVEL`, `AWS_PROFILE`) blocked connect** — users had to provide values for vars the server didn't actually need.
- **Session composer blocked send** when optional vars were missing from the personal environment.
- **Java `MergeMcpServerEnvSpecsStep` silently dropped `optional`** when merging MCP server env declarations into Agent specs, making all MCP-sourced vars appear required at the agent level.
- **No visual indicator** in the frontend to tell users which vars were optional vs required.

## Solution

Design principle: **Required vars gate; optional vars ride along.**

- Missing required var → hard blocker (backend error, frontend form).
- Missing optional var → silently skipped (still resolved and passed through if available, but never blocks connect, execution, or session send).
- Optional vars discoverable via read-only `EnvSection` badge but not shown in credential/setup forms.

## Implementation Details

### Go Backend (stigmer-server) — 5 files

- **`connect.go`** `resolveFromPersonalEnvironment`: checks `decl.GetOptional()` before adding to `missing` list. When no personal env exists and all vars are optional, returns an empty map instead of erroring.
- **`envmerge.ValidateRequiredKeys`**: new function returning sorted list of required declared keys absent from a filtered env map. 8 test cases.
- **Agent execution context step**: calls `ValidateRequiredKeys` after all injections (step 6.9), logs warning for missing required vars.
- **Workflow execution context step**: calls `ValidateRequiredKeys` after filtering (step 6.1).

### Java Backend (stigmer-cloud) — 3 files

- **`MergeMcpServerEnvSpecsStep`** bug fix: added `.setOptional(entry.getValue().getOptional())` to the builder. Previously all MCP-sourced vars appeared required at Agent level.
- **`McpServerConnectHandler`** `resolveFromPersonalEnvironment`: checks `decl.getOptional()` before adding to `missingRequired` list. When no personal env and all vars optional, returns empty map.
- **`MergeMcpServerEnvSpecsStepTest`**: new `optionalFlagPreserved` test.

### React Frontend (sdk/react) — 5 files

- **`EnvVarFormVariable`**: added `optional?: boolean` field for downstream filtering.
- **`diffEnv`**: populates `optional` on returned entries from proto declarations.
- **`useMcpServerCredentials`**: `isReady` and `missingVariables` now filter to required-only. Servers with all-optional missing vars are immediately ready.
- **`useMcpServerSetup`**: `addServer` and pool re-evaluation filter `diffEnv` results to required-only before deciding `ready` vs `needsSetup`.
- **`McpServerDetailView` `EnvSection`**: new `optional` badge alongside `secret`/`config`/`oauth` badges.

## Benefits

- **Users are no longer blocked by optional env vars** when connecting MCP servers or composing sessions.
- **MCP server authors** can confidently mark debugging/non-essential vars as optional knowing the platform respects the distinction.
- **The `optional` flag is consistent end-to-end**: proto → Go backend → Java backend → React frontend.
- **Bug fix** prevents optional MCP vars from being silently upgraded to required when merged into Agent specs.

## Impact

- **MCP server connect flow**: servers with only optional env vars can now be connected without providing any credentials.
- **Session composer**: send button no longer blocked by optional missing vars.
- **4 seedpack MCP servers** already have optional vars (`FASTMCP_LOG_LEVEL`, `AWS_PROFILE`, `MYSQL_PORT`, `MYSQL_DB`) that now correctly bypass the credential form.
- **Backward compatible**: default `optional=false` means all existing required vars continue to block as before.

## Related Work

- T02: Introduced `EnvVarDeclaration` proto with `optional` field
- T04: Classified optional vars in seedpack YAML
- T05: Migrated all consumers from `env_spec` to `env`, Java `McpEnvironmentValidator` first consumer of `optional`
- T06: This change — enforces `optional` across all remaining consumers

---

**Status**: ✅ Production Ready
**Timeline**: T06 of the 20260411.02 project (mcp-connect-retry-and-env-declaration)
